import { claimOutbox } from "@rwa/database";
import { createClock } from "@rwa/domain";
import { Pool } from "pg";

import { loadApiConfig } from "./config.js";

const config = loadApiConfig(process.env);
const clock = createClock(process.env);
const pool = new Pool({ connectionString: config.databaseUrl });
let stopping = false;

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    stopping = true;
  });
}

while (!stopping) {
  const messages = await claimOutbox(pool, 20, clock.now());
  if (messages.length === 0) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    continue;
  }
  for (const message of messages) {
    process.stdout.write(
      `${JSON.stringify({ level: "info", simulation: true, message: "outbox claimed", ...message })}\n`,
    );
  }
}

await pool.end();
