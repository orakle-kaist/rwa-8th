import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { LocalDeploymentManifest } from "@rwa/contracts-client";
import { Pool } from "pg";
import { createPublicClient, http, parseAbi, type Hex } from "viem";

import { anvilChain } from "../packages/contracts-client/src/index.js";

const root = resolve(import.meta.dirname, "..");
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("실제 PostgreSQL 대사를 위해 DATABASE_URL이 필요하다.");
const parsed = new URL(databaseUrl);
if (!parsed.pathname.replace(/^\//, "").endsWith("_test"))
  throw new Error("로컬 증거 검증은 이름이 _test로 끝나는 격리 데이터베이스만 사용한다.");

const manifestPath = process.env.LOCAL_CHAIN_MANIFEST_PATH ?? resolve(root, ".runtime/local-deployment.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as LocalDeploymentManifest;
const client = createPublicClient({ chain: anvilChain, transport: http(process.env.CHAIN_RPC_URL ?? manifest.rpcUrl) });
const pool = new Pool({ connectionString: databaseUrl });

try {
  const addresses = [...Object.values(manifest.contracts), ...Object.values(manifest.tokens)];
  for (const address of addresses) {
    const code = await client.getCode({ address });
    if (!code || code === "0x") throw new Error(`배포 코드가 없는 주소다: ${address}`);
  }

  const chain = await pool.query<{
    workflow_id: string;
    workflow_type: string;
    stage: string;
    transaction_hash: Hex;
    status: string;
    receipt: Record<string, unknown>;
  }>(
    `SELECT step.workflow_id,workflow.workflow_type,step.stage,step.transaction_hash,step.status,step.receipt
       FROM chain_execution_steps step JOIN workflows workflow USING (workflow_id)
       ORDER BY step.workflow_id,step.stage`,
  );
  if (chain.rows.length === 0) throw new Error("실제 생애주기 체인 실행 기록이 없다.");
  if (chain.rows.some((row) => row.status !== "CONFIRMED" || !/^0x[0-9a-f]{64}$/i.test(row.transaction_hash)))
    throw new Error("미확정 또는 합성 형식의 체인 실행 기록이 있다.");
  for (const row of chain.rows) {
    const receipt = await client.getTransactionReceipt({ hash: row.transaction_hash });
    if (receipt.status !== "success" || String(row.receipt.transactionHash ?? "").toLowerCase() !== row.transaction_hash.toLowerCase())
      throw new Error(`${row.workflow_id}/${row.stage} 영수증 대사가 맞지 않는다.`);
  }
  const workflowTypes = new Set(chain.rows.map((row) => row.workflow_type));
  for (const required of [
    "PRIMARY_ISSUANCE",
    "SECONDARY_TRADE",
    "MARKET_MAKER_HEDGE",
    "REDEMPTION",
    "WALLET_REPLACEMENT",
    "CORPORATE_ACTION",
  ])
    if (!workflowTypes.has(required))
      throw new Error(`${required} 업무에 실제 Anvil 실행 증거가 없다.`);
  const stages = new Set(chain.rows.map((row) => row.stage));
  for (const required of [
    "PRIMARY_PENDING_MINT",
    "PRIMARY_RELEASE",
    "SECONDARY_SETTLEMENT",
    "HEDGE_BUY_PENDING_MINT",
    "HEDGE_BUY_RELEASE",
    "REDEMPTION_LOCK",
    "REDEMPTION_T2",
    "REDEMPTION_BURN",
    "RECOVERY_EXECUTED",
    "CORPORATE_SPLIT_APPLIED",
  ])
    if (!stages.has(required)) throw new Error(`${required} 실제 체인 단계가 누락됐다.`);

  const institutionKeys = await pool.query<{ count: string }>(
    "SELECT count(*)::text count FROM mock_institution_keys WHERE revoked_at IS NULL",
  );
  const signedEvents = await pool.query<{ count: string; max_sequence: string }>(
    `SELECT count(*)::text count,COALESCE(max(source_sequence),0)::text max_sequence
       FROM inbox_messages WHERE source_id='00000000-0000-4000-8000-000000000401'`,
  );
  if (Number(institutionKeys.rows[0]?.count ?? 0) < 1 || Number(signedEvents.rows[0]?.count ?? 0) < 1)
    throw new Error("등록된 모의 기관 공개키 또는 검증된 기관 결과가 없다.");

  const official = await pool.query<{ total: string; enabled: string }>(
    `SELECT count(*)::text total,
      count(*) FILTER (WHERE primary_availability<>'DISABLED' OR secondary_availability<>'DISABLED' OR redemption_availability<>'DISABLED')::text enabled
       FROM products WHERE reference_version='KOSPI200-2026-08-28'`,
  );
  if (official.rows[0]?.total !== "201" || official.rows[0]?.enabled !== "0")
    throw new Error("공식 후보 201개의 비활성 경계가 깨졌다.");

  const reconciliation = await pool.query<{ security_id: string; settled_quantity: string; token_supply: string }>(
    `SELECT security_id,domestic_settled_quantity::text settled_quantity,token_total_supply::text token_supply
       FROM instrument_control_totals ORDER BY security_id`,
  );
  const totalsBySecurity = new Map(
    reconciliation.rows.map((row) => [row.security_id, BigInt(row.token_supply)]),
  );
  const secondaryTotal = await pool.query<{ token_supply: string }>(
    "SELECT token_total_supply::text token_supply FROM secondary_market_state WHERE security_id='990002'",
  );
  if (secondaryTotal.rows[0])
    totalsBySecurity.set("990002", BigInt(secondaryTotal.rows[0].token_supply));
  const supplyAbi = parseAbi(["function totalSupply() view returns (uint256)"]);
  const onchainSupply: Record<string, string> = {};
  for (const [securityId, token] of Object.entries(manifest.tokens)) {
    const supply = (await client.readContract({
      address: token,
      abi: supplyAbi,
      functionName: "totalSupply",
    })) as bigint;
    onchainSupply[securityId] = supply.toString();
    if (totalsBySecurity.get(securityId) !== supply)
      throw new Error(`${securityId} DB 토큰공급량과 실제 Anvil 총발행량이 다르다.`);
  }
  const result = {
    simulation: true,
    chainId: manifest.chainId,
    deployment: {
      contracts: Object.keys(manifest.contracts).length,
      tokens: Object.keys(manifest.tokens).length,
      safeThreshold: manifest.governance.threshold,
      minimumDelaySeconds: manifest.governance.minimumDelaySeconds,
    },
    chainExecutions: chain.rows.map((row) => ({
      workflowId: row.workflow_id,
      workflowType: row.workflow_type,
      stage: row.stage,
      transactionHash: row.transaction_hash,
      status: row.status,
    })),
    signedInstitutionEvidence: {
      activeKeys: Number(institutionKeys.rows[0]!.count),
      acceptedEvents: Number(signedEvents.rows[0]!.count),
      lastSequence: Number(signedEvents.rows[0]!.max_sequence),
    },
    officialCandidates: { count: 201, enabled: 0 },
    reconciliation: { database: reconciliation.rows, onchainSupply },
    verifiedAt: new Date().toISOString(),
  };
  const output = process.env.LOCAL_LIFECYCLE_EVIDENCE_PATH;
  if (output) {
    const absolute = resolve(root, output);
    await mkdir(resolve(absolute, ".."), { recursive: true });
    await writeFile(absolute, JSON.stringify(result, null, 2) + "\n", "utf8");
  }
  process.stdout.write(`actual local lifecycle receipts verified: ${chain.rows.length}\n`);
} finally {
  await pool.end();
}
