import { randomUUID } from "node:crypto";

import {
  acceptCommand,
  getComplaint,
  getCurrentConsent,
  getCurrentDisclosure,
  getProduct,
  getWorkflowView,
  listInstitutionTasks,
  listComplaints,
  listProducts,
  isPrimaryWorkflow,
} from "@rwa/database";
import {
  authenticateDemoBearer,
  parsePositiveLimit,
  walletOwnershipMessage,
  type Clock,
} from "@rwa/domain";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "pg";
import { getAddress, verifyMessage } from "viem";

function errorReply(
  reply: FastifyReply,
  input: {
    status: number;
    code: string;
    messageKo: string;
    correlationId?: string;
    responsibleRole?: string;
    nextActionKo: string;
  },
) {
  return reply.status(input.status).send({
    code: input.code,
    messageKo: input.messageKo,
    retryable: false,
    requestId: randomUUID(),
    correlationId: input.correlationId ?? randomUUID(),
    responsibleRole: input.responsibleRole ?? "PLATFORM_OPERATOR",
    nextActionKo: input.nextActionKo,
  });
}

function principal(request: FastifyRequest, reply: FastifyReply) {
  const actor = authenticateDemoBearer(request.headers.authorization);
  if (!actor) {
    errorReply(reply, {
      status: 401,
      code: "AUTHENTICATION_REQUIRED",
      messageKo: "합성 사용자 인증이 필요하다.",
      nextActionKo: "허용된 데모 사용자를 선택한다.",
    });
    return undefined;
  }
  return actor;
}

const institutionComplaintRoles = new Set([
  "PLATFORM_OPERATOR",
  "OVERSEAS_BROKER_OPERATOR",
  "COMPLIANCE_AUDITOR",
  "EXECUTION_ALLOCATION_CONFIRMER",
  "T2_RISK_APPROVER",
  "RIGHTS_ENTRY_APPROVER",
  "RIGHTS_RECORDING_CONFIRMER",
  "DOMESTIC_SETTLEMENT_CONFIRMER",
  "CUSTODY_QUANTITY_CONFIRMER",
]);

function requireInvestor(request: FastifyRequest, reply: FastifyReply) {
  const actor = principal(request, reply);
  if (!actor) return undefined;
  if (actor.role !== "INVESTOR") {
    errorReply(reply, {
      status: 403,
      code: "AUTHORIZATION_DENIED",
      messageKo: "투자자 역할만 요청할 수 있다.",
      nextActionKo: "합성 투자자 프로필을 선택한다.",
    });
    return undefined;
  }
  return actor;
}

function requireInstitutionReviewer(request: FastifyRequest, reply: FastifyReply) {
  const actor = principal(request, reply);
  if (!actor) return undefined;
  if (!institutionComplaintRoles.has(actor.role)) {
    errorReply(reply, {
      status: 403,
      code: "AUTHORIZATION_DENIED",
      messageKo: "해당 기관 업무를 검토할 권한이 없다.",
      nextActionKo: "토큰 플랫폼, 해외 증권사 또는 준법 담당 역할을 선택한다.",
    });
    return undefined;
  }
  return actor;
}

function commandHeaders(request: FastifyRequest, reply: FastifyReply) {
  const idempotencyKey = request.headers["idempotency-key"];
  const correlationId = request.headers["x-correlation-id"];
  if (
    typeof idempotencyKey !== "string" ||
    idempotencyKey.length < 16 ||
    typeof correlationId !== "string" ||
    !/^[0-9a-f-]{36}$/i.test(correlationId)
  ) {
    errorReply(reply, {
      status: 422,
      code: "INPUT_VALIDATION_FAILED",
      messageKo: "멱등키와 상관관계 ID가 필요하다.",
      nextActionKo: "요청 헤더를 확인한다.",
    });
    return undefined;
  }
  return { idempotencyKey, correlationId };
}

export async function registerProtectionRoutes(
  app: FastifyInstance,
  pool: Pool,
  clock: Clock,
): Promise<void> {
  app.get("/api/v1/products", async (request) => {
    const query = request.query as { limit?: string; cursor?: string };
    return listProducts(
      pool,
      parsePositiveLimit(query.limit, 20),
      Number(query.cursor ?? "0") || 0,
      clock.now(),
    );
  });

  app.get("/api/v1/products/:securityId", async (request, reply) => {
    const product = await getProduct(
      pool,
      (request.params as { securityId: string }).securityId,
      clock.now(),
    );
    return (
      product ??
      errorReply(reply, {
        status: 404,
        code: "PRODUCT_NOT_FOUND",
        messageKo: "상품 후보를 찾을 수 없다.",
        nextActionKo: "종목코드를 확인한다.",
      })
    );
  });

  app.get("/api/v1/disclosures/current", async (_request, reply) => {
    const disclosure = await getCurrentDisclosure(pool);
    return (
      disclosure ??
      errorReply(reply, {
        status: 404,
        code: "DISCLOSURE_NOT_FOUND",
        messageKo: "현재 위험공시가 없다.",
        nextActionKo: "해외 증권사 준법 담당이 공시를 확인한다.",
      })
    );
  });

  app.get("/api/v1/disclosure-consents/current", async (request, reply) => {
    const actor = requireInvestor(request, reply);
    if (!actor) return;
    return getCurrentConsent(pool, actor.principalId, clock.now());
  });

  async function submitCommand(
    request: FastifyRequest,
    reply: FastifyReply,
    input: { workflowType: string; commandType: string; payload: object },
  ) {
    const actor = principal(request, reply);
    const headers = commandHeaders(request, reply);
    if (!actor || !headers) return;
    const result = await acceptCommand(pool, {
      principalId: actor.principalId,
      role: actor.role,
      ...headers,
      ...input,
      now: clock.now(),
    });
    if (result.conflict)
      return errorReply(reply, {
        status: 409,
        code: "IDEMPOTENCY_CONFLICT",
        messageKo: "같은 멱등키가 다른 요청에 사용됐다.",
        correlationId: headers.correlationId,
        nextActionKo: "새 멱등키를 사용한다.",
      });
    return reply.status(202).send({
      requestId: result.workflowId,
      workflowId: result.workflowId,
      status: "ACCEPTED",
      statusUrl: `/api/v1/workflows/${result.workflowId}`,
    });
  }

  app.post("/api/v1/disclosure-consents", async (request, reply) => {
    const actor = requireInvestor(request, reply);
    if (!actor) return;
    const body = request.body as { disclosureId?: string; version?: string; consentedAt?: string };
    if (!body.disclosureId || !body.version || !body.consentedAt)
      return errorReply(reply, {
        status: 422,
        code: "INPUT_VALIDATION_FAILED",
        messageKo: "공시와 동의시각이 필요하다.",
        nextActionKo: "현재 공시를 다시 확인한다.",
      });
    return submitCommand(request, reply, {
      workflowType: "DISCLOSURE_CONSENT",
      commandType: "DISCLOSURE_CONSENT_REQUESTED",
      payload: body,
    });
  });

  app.post("/api/v1/wallet-link-requests", async (request, reply) => {
    const actor = requireInvestor(request, reply);
    if (!actor) return;
    const body = request.body as { wallet?: string; ownershipSignature?: `0x${string}` };
    try {
      if (!body.wallet || !body.ownershipSignature) throw new Error();
      const wallet = getAddress(body.wallet);
      const valid = await verifyMessage({
        address: wallet,
        message: walletOwnershipMessage(actor.principalId, wallet, "LINK"),
        signature: body.ownershipSignature,
      });
      if (!valid) throw new Error();
      return submitCommand(request, reply, {
        workflowType: "WALLET_LINKAGE",
        commandType: "WALLET_LINK_REQUESTED",
        payload: { wallet, ownershipSignature: body.ownershipSignature },
      });
    } catch {
      return errorReply(reply, {
        status: 422,
        code: "WALLET_SIGNATURE_INVALID",
        messageKo: "지갑 소유확인 서명이 일치하지 않는다.",
        nextActionKo: "현재 지갑으로 연결 메시지를 다시 서명한다.",
      });
    }
  });

  app.post("/api/v1/wallet-replacement-requests", async (request, reply) => {
    const actor = requireInvestor(request, reply);
    if (!actor) return;
    const body = request.body as {
      oldWallet?: string;
      newWallet?: string;
      reasonKo?: string;
      newWalletSignature?: `0x${string}`;
    };
    try {
      if (!body.oldWallet || !body.newWallet || !body.reasonKo || !body.newWalletSignature)
        throw new Error();
      const oldWallet = getAddress(body.oldWallet);
      const newWallet = getAddress(body.newWallet);
      const valid = await verifyMessage({
        address: newWallet,
        message: walletOwnershipMessage(actor.principalId, newWallet, "REPLACE"),
        signature: body.newWalletSignature,
      });
      if (!valid) throw new Error();
      return submitCommand(request, reply, {
        workflowType: "WALLET_REPLACEMENT",
        commandType: "WALLET_REPLACEMENT_REQUESTED",
        payload: {
          oldWallet,
          newWallet,
          reasonKo: body.reasonKo,
          newWalletSignature: body.newWalletSignature,
        },
      });
    } catch {
      return errorReply(reply, {
        status: 422,
        code: "WALLET_SIGNATURE_INVALID",
        messageKo: "새 지갑 소유확인 서명이 일치하지 않는다.",
        nextActionKo: "새 지갑으로 교체 메시지를 다시 서명한다.",
      });
    }
  });

  app.get("/api/v1/complaints", async (request, reply) => {
    const actor = principal(request, reply);
    if (!actor) return;
    if (actor.role !== "INVESTOR" && !institutionComplaintRoles.has(actor.role))
      return errorReply(reply, {
        status: 403,
        code: "AUTHORIZATION_DENIED",
        messageKo: "민원 조회 권한이 없다.",
        nextActionKo: "허용된 투자자 또는 기관 역할을 선택한다.",
      });
    return listComplaints(pool, actor.principalId, actor.role, clock.now());
  });

  app.get("/api/v1/complaints/:complaintId", async (request, reply) => {
    const actor = principal(request, reply);
    if (!actor) return;
    if (actor.role !== "INVESTOR" && !institutionComplaintRoles.has(actor.role))
      return errorReply(reply, {
        status: 403,
        code: "AUTHORIZATION_DENIED",
        messageKo: "민원 조회 권한이 없다.",
        nextActionKo: "허용된 투자자 또는 기관 역할을 선택한다.",
      });
    const complaint = await getComplaint(
      pool,
      (request.params as { complaintId: string }).complaintId,
      actor.principalId,
      actor.role,
      clock.now(),
    );
    return (
      complaint ??
      errorReply(reply, {
        status: 404,
        code: "COMPLAINT_NOT_FOUND",
        messageKo: "조회할 수 있는 민원이 없다.",
        nextActionKo: "민원 번호와 접근 권한을 확인한다.",
      })
    );
  });

  app.post("/api/v1/complaints", async (request, reply) => {
    const actor = requireInvestor(request, reply);
    if (!actor) return;
    const body = request.body as Record<string, unknown>;
    const complaintTypes = new Set([
      "PLATFORM_TECHNICAL",
      "BROKERAGE_ACCOUNT",
      "TRADE_ERROR",
      "REGULATORY",
    ]);
    if (
      typeof body.type !== "string" ||
      !complaintTypes.has(body.type) ||
      typeof body.titleKo !== "string" ||
      !body.titleKo.trim() ||
      typeof body.descriptionKo !== "string" ||
      !body.descriptionKo.trim() ||
      typeof body.disclosureVersion !== "string" ||
      !body.disclosureVersion
    )
      return errorReply(reply, {
        status: 422,
        code: "INPUT_VALIDATION_FAILED",
        messageKo: "민원 종류, 제목, 내용과 공시 버전이 필요하다.",
        nextActionKo: "필수 입력을 확인한다.",
      });
    return submitCommand(request, reply, {
      workflowType: "COMPLAINT",
      commandType: "COMPLAINT_SUBMIT_REQUESTED",
      payload: body,
    });
  });

  const complaintCommands: Array<[string, string]> = [
    ["assignments", "COMPLAINT_ASSIGN_REQUESTED"],
    ["processing-starts", "COMPLAINT_START_REQUESTED"],
    ["responses", "COMPLAINT_RESPONSE_REQUESTED"],
    ["correction-links", "COMPLAINT_CORRECTION_REQUESTED"],
    ["closures", "COMPLAINT_CLOSE_REQUESTED"],
  ];
  for (const [suffix, commandType] of complaintCommands) {
    app.post(`/api/v1/institution/complaints/:complaintId/${suffix}`, async (request, reply) => {
      const actor = requireInstitutionReviewer(request, reply);
      if (!actor) return;
      return submitCommand(request, reply, {
        workflowType: "COMPLAINT",
        commandType,
        payload: {
          ...(request.body as object),
          complaintId: (request.params as { complaintId: string }).complaintId,
        },
      });
    });
  }

  app.post("/api/v1/institution/tasks/:taskId/decisions", async (request, reply) => {
    const actor = requireInstitutionReviewer(request, reply);
    if (!actor) return;
    const taskId = (request.params as { taskId: string }).taskId;
    return submitCommand(request, reply, {
      workflowType: "INSTITUTION_DECISION",
      commandType: (await isPrimaryWorkflow(pool, taskId))
        ? "PRIMARY_DECISION_REQUESTED"
        : "INSTITUTION_DECISION_REQUESTED",
      payload: {
        ...(request.body as object),
        taskId,
      },
    });
  });

  app.get("/api/v1/institution/tasks", async (request, reply) => {
    const actor = requireInstitutionReviewer(request, reply);
    if (!actor) return;
    return listInstitutionTasks(pool, clock.now());
  });

  app.get("/api/v1/workflows/:workflowId", async (request, reply) => {
    const actor = principal(request, reply);
    if (!actor) return;
    const workflow = await getWorkflowView(
      pool,
      (request.params as { workflowId: string }).workflowId,
      actor.principalId,
      actor.role,
      clock.now(),
    );
    return (
      workflow ??
      errorReply(reply, {
        status: 404,
        code: "WORKFLOW_NOT_FOUND",
        messageKo: "업무를 찾을 수 없다.",
        nextActionKo: "업무 번호를 확인한다.",
      })
    );
  });
}
