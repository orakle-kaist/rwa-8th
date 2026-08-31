import { generateKeyPairSync } from "node:crypto";

import Fastify from "fastify";

const port = Number(process.env.MOCK_INSTITUTIONS_PORT ?? "4100");
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("MOCK_INSTITUTIONS_PORT가 올바르지 않다.");
}

// The key exists only for this process lifetime. No signing secret is written to disk.
const { publicKey } = generateKeyPairSync("ed25519");
const app = Fastify({ logger: true });

app.get("/health", async () => ({
  service: "mock-institutions",
  status: "ok",
  simulation: true,
  signingPublicKey: publicKey.export({ type: "spki", format: "pem" }),
}));

await app.listen({ host: "0.0.0.0", port });
