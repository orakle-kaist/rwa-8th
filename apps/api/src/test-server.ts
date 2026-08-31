import { claimOutbox, processProtectionMessage } from "@rwa/database";
import { createClock } from "@rwa/domain";
import { Pool } from "pg";

import { buildApp } from "./app.js";
import { loadApiConfig } from "./config.js";

const config = loadApiConfig(process.env);
const clock = createClock(process.env);
const pool = new Pool({ connectionString: config.databaseUrl });
const app = await buildApp({ clock, pool });
let processing = false;

const timer = setInterval(() => {
  if (processing) return;
  processing = true;
  void (async () => {
    const messages = await claimOutbox(pool, 20, clock.now());
    for (const message of messages) {
      if (message.eventType === "ELIGIBILITY_CHAIN_SYNC_REQUESTED") {
        throw new Error("브라우저 시험 서버에서는 체인 적격성 반영을 실행하지 않는다.");
      }
      await processProtectionMessage(pool, message, clock.now());
    }
  })()
    .catch((error) => {
      process.stderr.write(
        `${JSON.stringify({ level: "error", simulation: true, message: "browser outbox processing failed", error: error instanceof Error ? error.message : "unknown" })}\n`,
      );
    })
    .finally(() => {
      processing = false;
    });
}, 50);

app.addHook("onClose", async () => {
  clearInterval(timer);
  await pool.end();
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void app.close();
  });
}

await app.listen({ host: config.host, port: config.port });
