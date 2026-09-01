import { spawnSync } from "node:child_process";
import { access } from "node:fs/promises";
import { resolve } from "node:path";

import { Pool } from "pg";

import { recordLocalChainDeployment } from "./chain-execution.js";

const requiredConfirmation = "RESET_LOCAL_SYNTHETIC_RWA_POC";
const confirmed = process.argv.includes("--confirm=" + requiredConfirmation);
if (!confirmed) {
  throw new Error(
    "로컬 합성 시연 초기화에는 --confirm=" + requiredConfirmation + " 확인값이 필요하다.",
  );
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL이 필요하다.");
const parsed = new URL(databaseUrl);
const databaseName = parsed.pathname.replace(/^\//, "");
const localHosts = new Set(["localhost", "127.0.0.1", "postgres"]);
if (!localHosts.has(parsed.hostname) || databaseName !== "rwa_poc") {
  throw new Error(
    "시연 초기화는 localhost, 127.0.0.1 또는 compose postgres의 rwa_poc 데이터베이스만 허용한다.",
  );
}

const pool = new Pool({ connectionString: databaseUrl });
try {
  await pool.query("DROP SCHEMA public CASCADE");
  await pool.query("CREATE SCHEMA public");
} finally {
  await pool.end();
}

const migration = spawnSync("pnpm", ["db:migrate"], {
  cwd: resolve(import.meta.dirname, "../../.."),
  env: process.env,
  encoding: "utf8",
  stdio: "inherit",
});
if (migration.status !== 0) {
  throw new Error("스키마 초기화 뒤 승인 fixture 적재에 실패했다.");
}
const manifestPath = resolve(import.meta.dirname, "../../..", ".runtime/local-deployment.json");
await access(manifestPath);
const deployedPool = new Pool({ connectionString: databaseUrl });
try {
  await recordLocalChainDeployment(deployedPool, manifestPath);
} finally {
  await deployedPool.end();
}
process.stdout.write("local synthetic demo reset complete: rwa_poc\n");
