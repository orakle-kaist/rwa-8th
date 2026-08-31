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

app.get("/health", async () => ({
  service: "mock-institutions",
  status: "ok",
  simulation: true,
  signingPublicKey: publicKey.export({ type: "spki", format: "pem" }),
}));

app.post("/emit", async (request, reply) => {
  const input = request.body as {
    eventType?: string;
    data?: Record<string, unknown>;
    callbackUrl?: string;
  };
  if (!input.eventType || !input.data || !input.callbackUrl)
    return reply.status(422).send({ messageKo: "이벤트 종류, 데이터와 회신 주소가 필요하다." });
  sourceSequence += 1;
  const unsigned = {
    eventId: randomUUID(),
    eventType: input.eventType,
    sourceInstitutionId,
    sourceSequence,
    sentAt: new Date().toISOString(),
    keyId: "process-ed25519-1",
    sourceMetadata: {
      sourceOrganization: "모의 기관",
      sourceRecordId: randomUUID(),
      effectiveAt: new Date().toISOString(),
      receivedAt: new Date().toISOString(),
      policyVersion: "PRIMARY-SIM-1",
      simulation: true,
    },
    data: input.data,
  };
  const signature = sign(null, Buffer.from(canonicalJson(unsigned)), privateKey).toString(
    "base64url",
  );
  const response = await fetch(input.callbackUrl, {
    method: "POST",
    headers: { "content-type": "application/json", "x-correlation-id": randomUUID() },
    body: JSON.stringify({ ...unsigned, signature }),
  });
  return reply.status(response.ok ? 202 : 502).send({
    simulation: true,
    eventId: unsigned.eventId,
    sourceSequence,
    callbackStatus: response.status,
  });
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
