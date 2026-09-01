import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import type { Pool } from "pg";

export interface ChainExecutionRecord {
  workflowId: string;
  stage: string;
  status: "PENDING" | "SUBMITTED" | "CONFIRMED" | "FAILED" | "UNCERTAIN";
  transactionHash?: string;
  functionName: string;
  contractAddress: string;
}

export async function beginChainExecution(
  pool: Pool,
  input: {
    workflowId: string;
    stage: string;
    contractAddress: string;
    functionName: string;
    now: Date;
  },
): Promise<{ execute: boolean; record: ChainExecutionRecord }> {
  const result = await pool.query<Record<string, unknown>>(
    `INSERT INTO chain_execution_steps
      (execution_id,workflow_id,stage,status,contract_address,function_name,attempts,updated_at)
     VALUES ($1,$2,$3,'PENDING',$4,$5,1,$6)
     ON CONFLICT (workflow_id,stage) DO UPDATE SET
       attempts=chain_execution_steps.attempts+1,updated_at=EXCLUDED.updated_at
     RETURNING *`,
    [randomUUID(), input.workflowId, input.stage, input.contractAddress, input.functionName, input.now],
  );
  const row = result.rows[0]!;
  return {
    execute: row.status !== "CONFIRMED",
    record: {
      workflowId: String(row.workflow_id),
      stage: String(row.stage),
      status: row.status as ChainExecutionRecord["status"],
      functionName: String(row.function_name),
      contractAddress: String(row.contract_address),
      ...(row.transaction_hash ? { transactionHash: String(row.transaction_hash) } : {}),
    },
  };
}

export async function markChainSubmitted(
  pool: Pool,
  input: { workflowId: string; stage: string; transactionHash: string; nonce?: bigint; now: Date },
) {
  await pool.query(
    `UPDATE chain_execution_steps SET status='SUBMITTED',transaction_hash=$3,
       transaction_nonce=$4,submitted_at=COALESCE(submitted_at,$5),last_error=NULL,updated_at=$5
     WHERE workflow_id=$1 AND stage=$2`,
    [input.workflowId, input.stage, input.transactionHash, input.nonce?.toString() ?? null, input.now],
  );
}

export async function markChainConfirmed(
  pool: Pool,
  input: { workflowId: string; stage: string; transactionHash: string; receipt: unknown; now: Date },
) {
  await pool.query(
    `UPDATE chain_execution_steps SET status='CONFIRMED',transaction_hash=$3,receipt=$4::jsonb,
       confirmed_at=$5,last_error=NULL,updated_at=$5 WHERE workflow_id=$1 AND stage=$2`,
    [input.workflowId, input.stage, input.transactionHash, JSON.stringify(input.receipt), input.now],
  );
}

export async function markChainFailed(
  pool: Pool,
  input: {
    workflowId: string;
    stage: string;
    status: "FAILED" | "UNCERTAIN";
    reason: string;
    transactionHash?: string;
    now: Date;
  },
) {
  await pool.query(
    `UPDATE chain_execution_steps SET status=$3,last_error=$4,
       transaction_hash=COALESCE($5,transaction_hash),updated_at=$6 WHERE workflow_id=$1 AND stage=$2`,
    [input.workflowId, input.stage, input.status, input.reason, input.transactionHash ?? null, input.now],
  );
}

export async function recordLocalChainDeployment(
  pool: Pool,
  manifestPath: string,
  now = new Date(),
) {
  const bytes = await readFile(manifestPath);
  const manifest = JSON.parse(bytes.toString("utf8")) as {
    chainId: number;
    deployedAt: string;
    tokens: Record<string, string>;
  };
  if (manifest.chainId !== 31337) throw new Error("로컬 DB에는 Anvil 배포정보만 연결할 수 있다.");
  for (const securityId of ["990001", "990002", "990003"])
    if (!/^0x[0-9a-fA-F]{40}$/.test(manifest.tokens[securityId] ?? ""))
      throw new Error(`${securityId} 로컬 토큰 주소가 없다.`);
  await pool.query(
    `INSERT INTO local_chain_deployments(chain_id,manifest,manifest_sha256,deployed_at,recorded_at)
     VALUES (31337,$1::jsonb,$2,$3,$4)
     ON CONFLICT (chain_id) DO UPDATE SET manifest=EXCLUDED.manifest,
       manifest_sha256=EXCLUDED.manifest_sha256,deployed_at=EXCLUDED.deployed_at,recorded_at=EXCLUDED.recorded_at`,
    [JSON.stringify(manifest), createHash("sha256").update(bytes).digest("hex"), manifest.deployedAt, now],
  );
  for (const [securityId, tokenAddress] of Object.entries(manifest.tokens))
    await pool.query("UPDATE local_simulation_instruments SET token_address=$2 WHERE security_id=$1", [
      securityId,
      tokenAddress,
    ]);
}

export async function getLocalChainMetadata(pool: Pool) {
  const result = await pool.query<{ manifest: Record<string, unknown> }>(
    "SELECT manifest FROM local_chain_deployments WHERE chain_id=31337",
  );
  const manifest = result.rows[0]?.manifest as
    | {
        contracts?: { intentVerifier?: string; mockUsdc?: string };
        tokens?: Record<string, string>;
        policyVersion?: string;
      }
    | undefined;
  return {
    verifyingContract:
      manifest?.contracts?.intentVerifier ?? "0x0000000000000000000000000000000000000000",
    mockUsdcAddress:
      manifest?.contracts?.mockUsdc ?? "0x0000000000000000000000000000000000000000",
    tokens: manifest?.tokens ?? {},
    policyVersion: "LOCAL-POLICY-V1",
  };
}
