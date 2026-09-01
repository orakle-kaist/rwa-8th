import { getWorkflowTimeline, listRightsPositions, listWorkflowActivities } from "@rwa/database";
import { authenticateDemoBearer, parsePositiveLimit, type Clock } from "@rwa/domain";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";

function actor(authorization: string | undefined) {
  return authenticateDemoBearer(authorization);
}

export async function registerCommonRoutes(
  app: FastifyInstance,
  pool: Pool,
  clock: Clock,
): Promise<void> {
  app.get("/api/v1/positions", async (request, reply) => {
    const principal = actor(request.headers.authorization);
    if (!principal)
      return reply.status(401).send({
        code: "AUTHENTICATION_REQUIRED",
        messageKo: "합성 사용자 인증이 필요하다.",
        retryable: false,
        responsibleRole: "PLATFORM_OPERATOR",
        nextActionKo: "허용된 데모 사용자를 선택한다.",
      });
    const query = request.query as { limit?: string; cursor?: string };
    return listRightsPositions(pool, {
      principalId: principal.principalId,
      role: principal.role,
      limit: parsePositiveLimit(query.limit, 20),
      ...(query.cursor ? { cursor: query.cursor } : {}),
      now: clock.now(),
    });
  });

  app.get("/api/v1/activities", async (request, reply) => {
    const principal = actor(request.headers.authorization);
    if (!principal)
      return reply.status(401).send({
        code: "AUTHENTICATION_REQUIRED",
        messageKo: "합성 사용자 인증이 필요하다.",
        retryable: false,
        responsibleRole: "PLATFORM_OPERATOR",
        nextActionKo: "허용된 데모 사용자를 선택한다.",
      });
    const query = request.query as { limit?: string; cursor?: string };
    return listWorkflowActivities(pool, {
      principalId: principal.principalId,
      role: principal.role,
      limit: parsePositiveLimit(query.limit, 20),
      ...(query.cursor ? { cursor: query.cursor } : {}),
      now: clock.now(),
    });
  });

  app.get("/api/v1/workflows/:workflowId/timeline", async (request, reply) => {
    const principal = actor(request.headers.authorization);
    if (!principal)
      return reply.status(401).send({
        code: "AUTHENTICATION_REQUIRED",
        messageKo: "합성 사용자 인증이 필요하다.",
        retryable: false,
        responsibleRole: "PLATFORM_OPERATOR",
        nextActionKo: "허용된 데모 사용자를 선택한다.",
      });
    const timeline = await getWorkflowTimeline(pool, {
      workflowId: (request.params as { workflowId: string }).workflowId,
      principalId: principal.principalId,
      role: principal.role,
      now: clock.now(),
    });
    return (
      timeline ??
      reply.status(404).send({
        code: "WORKFLOW_NOT_FOUND",
        messageKo: "업무를 찾을 수 없다.",
        retryable: false,
        responsibleRole: "PLATFORM_OPERATOR",
        nextActionKo: "업무 번호와 조회 권한을 확인한다.",
      })
    );
  });
}
