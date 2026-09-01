import cors from "@fastify/cors";
import { authenticateDemoBearer, type Clock } from "@rwa/domain";
import Fastify, { type FastifyInstance } from "fastify";
import type { Pool } from "pg";

import {
  getCustomerReadiness,
  getLocalPrimaryScenario,
  getLocalSecondaryScenario,
  getLocalRedemptionScenario,
  getLocalRightsScenario,
  registerMockInstitutionKey,
} from "@rwa/database";

import { registerProtectionRoutes } from "./protection-routes.js";
import { registerPrimaryRoutes } from "./primary-routes.js";
import { registerSecondaryRoutes } from "./secondary-routes.js";
import { registerHedgeRoutes } from "./hedge-routes.js";
import { registerRedemptionRoutes } from "./redemption-routes.js";
import { registerRightsRoutes } from "./rights-routes.js";
import { registerCommonRoutes } from "./common-routes.js";

export interface BuildAppOptions {
  clock: Clock;
  logger?: boolean;
  pool?: Pool;
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? true });
  const browserOrigins = ["http://localhost:3000", "http://127.0.0.1:3000"];
  if (process.env.WEB_ORIGIN) browserOrigins.push(process.env.WEB_ORIGIN);
  await app.register(cors, { origin: [...new Set(browserOrigins)] });

  app.get("/health", async () => ({
    service: "rwa-api",
    status: "ok",
    simulation: true,
    time: options.clock.now().toISOString(),
  }));

  app.post("/internal/mock-adapter-keys", async (request, reply) => {
    if (!options.pool || request.headers["x-simulation-registration-token"] !== "local-mock-only")
      return reply
        .status(403)
        .send({ simulation: true, messageKo: "모의 기관 키 등록 권한이 없다." });
    const body = request.body as Record<string, unknown>;
    await registerMockInstitutionKey(options.pool, {
      sourceInstitutionId: String(body.sourceInstitutionId),
      keyId: String(body.keyId),
      publicKeyPem: String(body.publicKeyPem),
      now: options.clock.now(),
    });
    return reply.status(202).send({ simulation: true, status: "REGISTERED" });
  });

  app.get("/api/v1/session", async (request, reply) => {
    const principal = authenticateDemoBearer(request.headers.authorization);
    if (!principal) {
      return reply.status(401).send({
        code: "AUTHENTICATION_REQUIRED",
        messageKo: "합성 사용자 인증이 필요하다.",
        retryable: false,
        responsibleRole: "PLATFORM_OPERATOR",
        nextActionKo: "허용된 데모 사용자를 선택한다.",
        simulation: true,
      });
    }

    const readiness = options.pool
      ? await getCustomerReadiness(options.pool, principal.principalId, options.clock.now())
      : undefined;
    const localPrimaryScenario = options.pool
      ? await getLocalPrimaryScenario(options.pool, principal.principalId, options.clock.now())
      : undefined;
    const localSecondaryScenario = options.pool
      ? await getLocalSecondaryScenario(options.pool, principal.principalId, options.clock.now())
      : undefined;
    const localRedemptionScenario = options.pool
      ? await getLocalRedemptionScenario(options.pool, principal.principalId, options.clock.now())
      : undefined;
    const localRightsScenario = options.pool
      ? await getLocalRightsScenario(
          options.pool,
          principal.role === "INVESTOR"
            ? principal.principalId
            : "00000000-0000-4000-8000-000000000001",
          options.clock.now(),
        )
      : undefined;
    return {
      actorId: principal.principalId,
      role: principal.role,
      simulation: true,
      ...(readiness ? { customerReadiness: readiness } : {}),
      ...(options.pool
        ? {
            localPrimaryScenario,
            localSecondaryScenario,
            localRedemptionScenario,
            localRightsScenario,
            localInvestorJourney: {
              securityId: "990001",
              displayName: "모의 삼성전자 수탁권리",
              referenceSecurityId: "005930",
              referenceKrw: "257000",
              referenceUsdMinor: "18619",
              normalBidUsdMinor: "18526",
              normalAskUsdMinor: "18712",
              usdKrwRate: "1380.3",
              primary: localPrimaryScenario,
              secondary: localSecondaryScenario,
              redemption: localRedemptionScenario,
              rights: localRightsScenario,
              simulation: true,
            },
          }
        : {}),
      projection: {
        projectionAsOf: options.clock.now().toISOString(),
        lastEventSequence: 0,
        projectionStatus: "CURRENT",
      },
    };
  });

  if (options.pool) {
    await registerCommonRoutes(app, options.pool, options.clock);
    await registerProtectionRoutes(app, options.pool, options.clock);
    await registerPrimaryRoutes(app, options.pool, options.clock);
    await registerSecondaryRoutes(app, options.pool, options.clock);
    await registerHedgeRoutes(app, options.pool, options.clock);
    await registerRedemptionRoutes(app, options.pool, options.clock);
    await registerRightsRoutes(app, options.pool, options.clock);
  }

  return app;
}
