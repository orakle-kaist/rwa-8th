import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("전체 로컬 검증에는 이름이 _test로 끝나는 DATABASE_URL이 필요하다.");
if (!new URL(databaseUrl).pathname.replace(/^\//, "").endsWith("_test"))
  throw new Error("전체 로컬 검증은 격리된 _test 데이터베이스만 사용한다.");

const runtime = resolve(root, ".runtime");
await mkdir(runtime, { recursive: true });
const rpcUrl = process.env.CHAIN_RPC_URL ?? "http://127.0.0.1:8545";
const manifestPath = resolve(runtime, "local-deployment.json");
let anvil: ChildProcess | undefined;

async function rpcAvailable() {
  return fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
  }).then((response) => response.ok).catch(() => false);
}

async function ensureAnvil() {
  if (await rpcAvailable()) return;
  const url = new URL(rpcUrl);
  anvil = spawn("anvil", ["--silent", "--host", url.hostname, "--port", url.port || "8545", "--chain-id", "31337"], {
    cwd: root,
    stdio: ["ignore", "inherit", "inherit"],
  });
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (await rpcAvailable()) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error("Anvil이 시작되지 않았다.");
}

function run(label: string, command: string, args: string[], extra: NodeJS.ProcessEnv = {}) {
  process.stdout.write(`\n[전체 로컬 검증] ${label}\n`);
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      CHAIN_RPC_URL: rpcUrl,
      ANVIL_RPC_URL: rpcUrl,
      LOCAL_CHAIN_MANIFEST_PATH: manifestPath,
      ...extra,
    },
  });
  if (result.status !== 0) throw new Error(`${label} 실패`);
}

try {
  await ensureAnvil();
  run("빠른 검증", "pnpm", ["test:quick"]);
  run("PostgreSQL", "pnpm", ["test:database"]);
  run("API", "pnpm", ["test:api"]);
  run("계약 클라이언트", "pnpm", ["test:chain"]);
  run("Anvil 초기화", "cast", ["rpc", "--rpc-url", rpcUrl, "anvil_reset"]);
  run("전체 계약 배포", "pnpm", ["chain:deploy:local"]);
  run("Chromium 전체 생애주기", "pnpm", ["test:browser"]);
  run("승인시험 76개", "pnpm", ["test:acceptance:trace"]);
  run("영수증·기관서명·대사", "pnpm", ["exec", "tsx", "scripts/verify-local-lifecycle-evidence.ts"]);
} finally {
  if (anvil) anvil.kill("SIGTERM");
}
