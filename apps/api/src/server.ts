import { createClock } from "@rwa/domain";

import { buildApp } from "./app.js";
import { loadApiConfig } from "./config.js";

const config = loadApiConfig(process.env);
const app = await buildApp({ clock: createClock(process.env) });

await app.listen({ host: config.host, port: config.port });
