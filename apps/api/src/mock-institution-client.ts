import { randomUUID } from "node:crypto";

export async function submitMockInstitutionCommand(input: {
  path: "domestic-orders" | "funding-requests" | "settlement-inquiries" | "custody-inquiries" | "rights-actions";
  workflowId: string;
  commandType: string;
  data: Record<string, unknown>;
  idempotencyKey: string;
  correlationId?: string;
  now: Date;
}) {
  const base = process.env.MOCK_INSTITUTIONS_URL;
  if (!base) return false;
  const response = await fetch(`${base.replace(/\/$/, "")}/mock/v1/${input.path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer local-synthetic-adapter",
      "idempotency-key": input.idempotencyKey,
      "x-correlation-id": input.correlationId ?? randomUUID(),
    },
    body: JSON.stringify({
      commandId: randomUUID(),
      workflowId: input.workflowId,
      commandType: input.commandType,
      requestedAt: input.now.toISOString(),
      simulation: true,
      data: { ...input.data, simulation: true },
    }),
  });
  if (!response.ok) throw new Error(`모의 기관 요청 접수 실패: ${response.status}`);
  return true;
}
