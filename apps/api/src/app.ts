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
  await app.register(cors, { origin: ["http://localhost:3000", "http://127.0.0.1:3000"] });

  app.get("/health", async () => ({
    service: "rwa-api",
    status: "ok",
    simulation: true,
    time: options.clock.now().toISOString(),
  }));

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
    return {
      actorId: principal.principalId,
      role: principal.role,
      simulation: true,
      ...(readiness ? { customerReadiness: readiness } : {}),
      ...(options.pool
        ? {
            localPrimaryScenario: await getLocalPrimaryScenario(
              options.pool,
              principal.principalId,
              options.clock.now(),
            ),
            localSecondaryScenario: await getLocalSecondaryScenario(
              options.pool,
              principal.principalId,
              options.clock.now(),
            ),
            localRedemptionScenario: await getLocalRedemptionScenario(
              options.pool,
              principal.principalId,
              options.clock.now(),
            ),
            localRightsScenario: await getLocalRightsScenario(
              options.pool,
              principal.role === "INVESTOR"
                ? principal.principalId
                : "00000000-0000-4000-8000-000000000001",
              options.clock.now(),
            ),
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
