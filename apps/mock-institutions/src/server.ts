import { generateKeyPairSync, randomUUID, sign } from "node:crypto";

import Fastify from "fastify";

const port = Number(process.env.MOCK_INSTITUTIONS_PORT ?? "4100");
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("MOCK_INSTITUTIONS_PORT가 올바르지 않다.");
}

// The key exists only for this process lifetime. No signing secret is written to disk.
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const app = Fastify({ logger: true });
let sourceSequence = 0;
const sourceInstitutionId = "00000000-0000-4000-8000-000000000401";
const keyId = "process-ed25519-1";
const callbackUrl =
  process.env.PLATFORM_ADAPTER_CALLBACK_URL ?? "http://127.0.0.1:4000/api/v1/adapter-events";
const idempotency = new Map<
  string,
  { requestHash: string; eventId: string; sourceSequence: number }
>();

app.get("/health", async () => ({
  service: "mock-institutions",
  status: "ok",
  simulation: true,
  signingPublicKey: publicKey.export({ type: "spki", format: "pem" }),
}));

async function registerPublicKey() {
  const registrationUrl = process.env.PLATFORM_KEY_REGISTRATION_URL;
  if (!registrationUrl) return;
  // Browser acceptance resets and migrates PostgreSQL before the API starts.
  // Keep the process alive long enough for that guarded startup to finish.
  for (let attempt = 1; attempt <= 120; attempt += 1) {
    const response = await fetch(registrationUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-simulation-registration-token": "local-mock-only",
      },
      body: JSON.stringify({
        sourceInstitutionId,
        keyId,
        publicKeyPem: publicKey.export({ type: "spki", format: "pem" }),
        simulation: true,
      }),
    }).catch(() => undefined);
    if (response?.ok) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("모의 기관 공개키 등록에 실패했다.");
}

async function emitSigned(
  eventType: string,
  data: Record<string, unknown>,
  destination = callbackUrl,
) {
  sourceSequence += 1;
  const unsigned = {
    eventId: randomUUID(),
    eventType,
    sourceInstitutionId,
    sourceSequence,
    sentAt: new Date().toISOString(),
    keyId,
    sourceMetadata: {
      sourceOrganization: "모의 기관",
      sourceRecordId: randomUUID(),
      effectiveAt: new Date().toISOString(),
      receivedAt: new Date().toISOString(),
      policyVersion: "LOCAL-POLICY-V1",
      simulation: true,
    },
    data: { ...data, simulation: true },
  };
  const signature = sign(null, Buffer.from(canonicalJson(unsigned)), privateKey).toString(
    "base64url",
  );
  const response = await fetch(destination, {
    method: "POST",
    headers: { "content-type": "application/json", "x-correlation-id": randomUUID() },
    body: JSON.stringify({ ...unsigned, signature }),
  });
  if (!response.ok) throw new Error(`플랫폼 기관결과 회신 실패: ${response.status}`);
  return { eventId: unsigned.eventId, sourceSequence };
}

function routeEventType(path: string, commandType: string, explicit?: unknown) {
  if (typeof explicit === "string" && /^[a-z0-9.-]+\.v1$/.test(explicit)) return explicit;
  const mapping: Record<string, string> = {
    "/mock/v1/domestic-orders:PRIMARY_EXECUTION": "primary.execution-confirmed.v1",
    "/mock/v1/domestic-orders:REDEMPTION_EXECUTION": "redemption.execution-confirmed.v1",
    "/mock/v1/settlement-inquiries:PRIMARY_SETTLEMENT": "primary.domestic-settlement-confirmed.v1",
    "/mock/v1/settlement-inquiries:REDEMPTION_SETTLEMENT": "redemption.sale-proceeds-settled.v1",
    "/mock/v1/custody-inquiries:PRIMARY_CUSTODY": "primary.custody-confirmed.v1",
    "/mock/v1/rights-actions:REDEMPTION_RIGHTS": "redemption.rights-terminated.v1",
    "/mock/v1/funding-requests:REDEMPTION_USD_PAYMENT": "redemption.usd-paid.v1",
  };
  const eventType = mapping[`${path}:${commandType}`];
  if (!eventType) throw new Error("지원하지 않는 모의 기관 명령이다.");
  return eventType;
}

for (const path of [
  "/mock/v1/domestic-orders",
  "/mock/v1/funding-requests",
  "/mock/v1/settlement-inquiries",
  "/mock/v1/custody-inquiries",
  "/mock/v1/rights-actions",
]) {
  app.post(path, async (request, reply) => {
    const key = String(request.headers["idempotency-key"] ?? "");
    const correlationId = String(request.headers["x-correlation-id"] ?? "");
    const body = request.body as Record<string, unknown>;
    if (
      key.length < 16 ||
      !correlationId ||
      body.simulation !== true ||
      typeof body.workflowId !== "string" ||
      typeof body.commandType !== "string" ||
      !body.data
    )
      return reply
        .status(422)
        .send({ simulation: true, messageKo: "모의 기관 명령 형식이 올바르지 않다." });
    const requestHash = canonicalJson(body);
    const previous = idempotency.get(key);
    if (previous)
      return previous.requestHash === requestHash
        ? reply.status(202).send({
            requestId: previous.eventId,
            workflowId: body.workflowId,
            status: "ACCEPTED",
            statusUrl: `/mock/events/${previous.eventId}`,
          })
        : reply
            .status(409)
            .send({ simulation: true, messageKo: "같은 멱등키의 명령 내용이 다르다." });
    const data: Record<string, unknown> = {
      ...(body.data as Record<string, unknown>),
      taskId: body.workflowId,
    };
    const explicit = data.resultEventType;
    delete data.resultEventType;
    const emitted = await emitSigned(routeEventType(path, body.commandType, explicit), data);
    idempotency.set(key, { requestHash, ...emitted });
    return reply.status(202).send({
      requestId: emitted.eventId,
      workflowId: body.workflowId,
      status: "ACCEPTED",
      statusUrl: `/mock/events/${emitted.eventId}`,
    });
  });
}

app.post("/emit", async (request, reply) => {
  const input = request.body as {
    eventType?: string;
    data?: Record<string, unknown>;
    callbackUrl?: string;
  };
  if (!input.eventType || !input.data || !input.callbackUrl)
    return reply.status(422).send({ messageKo: "이벤트 종류, 데이터와 회신 주소가 필요하다." });
  try {
    const emitted = await emitSigned(input.eventType, input.data, input.callbackUrl);
    return reply.status(202).send({
      simulation: true,
      ...emitted,
      callbackStatus: 202,
    });
  } catch (error) {
    return reply.status(502).send({
      simulation: true,
      messageKo: error instanceof Error ? error.message : "기관 결과 전송 실패",
    });
  }
});

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(",")}}`;
}

await app.listen({ host: "0.0.0.0", port });
await registerPublicKey();
