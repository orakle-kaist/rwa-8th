import { randomUUID } from "node:crypto";

import { acceptCommand, listHolds, listRegulatoryReports } from "@rwa/database";
import { authenticateDemoBearer, type Clock } from "@rwa/domain";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "pg";

function error(reply: FastifyReply, status: number, code: string, messageKo: string) {
  return reply.status(status).send({
    code,
    messageKo,
    retryable: false,
    requestId: randomUUID(),
    correlationId: randomUUID(),
    responsibleRole: "OVERSEAS_BROKER_OPERATOR",
    nextActionKo: "권리업무 상태, 역할과 증거를 확인한다.",
    simulation: true,
  });
}

function actor(request: FastifyRequest, reply: FastifyReply) {
  const principal = authenticateDemoBearer(request.headers.authorization);
  if (!principal) {
    error(reply, 401, "AUTHENTICATION_REQUIRED", "합성 사용자 인증이 필요하다.");
    return undefined;
  }
  return principal;
}

function headers(request: FastifyRequest, reply: FastifyReply) {
  const idempotencyKey = request.headers["idempotency-key"];
  const correlationId = request.headers["x-correlation-id"];
  if (
    typeof idempotencyKey !== "string" ||
    idempotencyKey.length < 16 ||
    typeof correlationId !== "string" ||
    !/^[0-9a-f-]{36}$/i.test(correlationId)
  ) {
    error(reply, 422, "INPUT_VALIDATION_FAILED", "멱등키와 상관관계 ID가 필요하다.");
    return undefined;
  }
  return { idempotencyKey, correlationId };
}

async function submit(
  request: FastifyRequest,
  reply: FastifyReply,
  pool: Pool,
  clock: Clock,
  workflowType: string,
  commandType: string,
  payload: object,
) {
  const principal = actor(request, reply);
  const commandHeaders = headers(request, reply);
  if (!principal || !commandHeaders) return;
  const result = await acceptCommand(pool, {
    principalId: principal.principalId,
    role: principal.role,
    ...commandHeaders,
    workflowType,
    commandType,
    payload,
    now: clock.now(),
  });
  if (result.conflict)
    return error(reply, 409, "IDEMPOTENCY_CONFLICT", "같은 멱등키의 요청내용이 다르다.");
  return reply.status(202).send({
    requestId: result.workflowId,
    workflowId: result.workflowId,
    status: "ACCEPTED",
    statusUrl: `/api/v1/workflows/${result.workflowId}`,
  });
}

export async function registerRightsRoutes(app: FastifyInstance, pool: Pool, clock: Clock) {
  app.post("/api/v1/dividend-conversions", async (request, reply) => {
    const principal = actor(request, reply);
    if (!principal) return;
    if (principal.role !== "INVESTOR")
      return error(reply, 403, "AUTHORIZATION_DENIED", "투자자만 배당 전환을 요청할 수 있다.");
    const body = request.body as { dividendPaymentId?: string; quoteId?: string };
    if (!body.dividendPaymentId || !body.quoteId)
      return error(reply, 422, "INPUT_VALIDATION_FAILED", "배당 지급건과 견적이 필요하다.");
    return submit(
      request,
      reply,
      pool,
      clock,
      "DIVIDEND_CONVERSION",
      "DIVIDEND_CONVERSION_REQUESTED",
      body,
    );
  });

  app.post("/api/v1/voting-instructions", async (request, reply) => {
    const principal = actor(request, reply);
    if (!principal) return;
    if (principal.role !== "INVESTOR")
      return error(reply, 403, "AUTHORIZATION_DENIED", "투자자만 의결권 지시를 제출할 수 있다.");
    const body = request.body as { meetingId?: string; agendaId?: string; instruction?: string };
    if (
      !body.meetingId ||
      !body.agendaId ||
      !new Set(["FOR", "AGAINST", "ABSTAIN"]).has(body.instruction ?? "")
    )
      return error(
        reply,
        422,
        "INPUT_VALIDATION_FAILED",
        "의결 안건과 찬성·반대·기권 지시가 필요하다.",
      );
    return submit(
      request,
      reply,
      pool,
      clock,
      "VOTING_INSTRUCTION",
      "VOTING_INSTRUCTION_REQUESTED",
      body,
    );
  });

  app.post("/api/v1/reconciliations", async (request, reply) => {
    const principal = actor(request, reply);
    if (!principal) return;
    if (
      !new Set(["PLATFORM_OPERATOR", "OVERSEAS_BROKER_OPERATOR", "COMPLIANCE_AUDITOR"]).has(
        principal.role,
      )
    )
      return error(reply, 403, "AUTHORIZATION_DENIED", "대사 실행 권한이 없다.");
    const body = request.body as { asOf?: string; scope?: string; securityId?: string };
    if (!body.asOf || !new Set(["SECURITY", "CUSTOMER", "SYSTEM"]).has(body.scope ?? ""))
      return error(reply, 422, "INPUT_VALIDATION_FAILED", "대사 기준시각과 범위가 필요하다.");
    return submit(request, reply, pool, clock, "RECONCILIATION", "RECONCILIATION_REQUESTED", body);
  });

  app.get("/api/v1/holds", async (request, reply) => {
    if (!actor(request, reply)) return;
    return listHolds(pool, clock.now());
  });

  app.post("/api/v1/holds/:holdId/release-decisions", async (request, reply) => {
    const principal = actor(request, reply);
    if (!principal) return;
    if (principal.role !== "COMPLIANCE_AUDITOR")
      return error(
        reply,
        403,
        "AUTHORIZATION_DENIED",
        "독립 준법·감사 담당만 재개를 승인할 수 있다.",
      );
    const body = request.body as { decision?: string; reasonKo?: string };
    if (body.decision !== "APPROVE" || !body.reasonKo)
      return error(reply, 422, "INPUT_VALIDATION_FAILED", "재개 승인과 근거가 필요하다.");
    return submit(request, reply, pool, clock, "HOLD_RELEASE", "HOLD_RELEASE_DECISION_REQUESTED", {
      ...body,
      holdId: (request.params as { holdId: string }).holdId,
    });
  });

  app.get("/api/v1/regulatory-reports", async (request, reply) => {
    const principal = actor(request, reply);
    if (!principal) return;
    if (!new Set(["OVERSEAS_BROKER_OPERATOR", "COMPLIANCE_AUDITOR"]).has(principal.role))
      return error(reply, 403, "AUTHORIZATION_DENIED", "월별 보고 조회 권한이 없다.");
    return listRegulatoryReports(pool, clock.now());
  });

  app.post("/api/v1/regulatory-reports/:reportId/submission-results", async (request, reply) => {
    const principal = actor(request, reply);
    if (!principal) return;
    if (principal.role !== "OVERSEAS_BROKER_OPERATOR")
      return error(
        reply,
        403,
        "AUTHORIZATION_DENIED",
        "해외 증권사만 보고 제출결과를 기록할 수 있다.",
      );
    const body = request.body as { result?: string; sourceMetadata?: Record<string, unknown> };
    if (
      !new Set(["ACCEPTED", "REJECTED", "CORRECTION_REQUIRED"]).has(body.result ?? "") ||
      !body.sourceMetadata
    )
      return error(reply, 422, "INPUT_VALIDATION_FAILED", "제출결과와 모의 기관 증거가 필요하다.");
    return submit(request, reply, pool, clock, "REPORT_SUBMISSION", "REPORT_SUBMISSION_REQUESTED", {
      ...body,
      reportId: (request.params as { reportId: string }).reportId,
      sourceRecordId: String(body.sourceMetadata.sourceRecordId ?? "SIM-REPORT-RESULT"),
    });
  });
}
