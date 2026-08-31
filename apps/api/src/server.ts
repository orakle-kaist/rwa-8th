import { createClock } from "@rwa/domain";

import { buildApp } from "./app.js";
import { loadApiConfig } from "./config.js";
import { Pool } from "pg";

const config = loadApiConfig(process.env);
const pool = new Pool({ connectionString: config.databaseUrl });
const app = await buildApp({ clock: createClock(process.env), pool });

app.addHook("onClose", async () => pool.end());

await app.listen({ host: config.host, port: config.port });
