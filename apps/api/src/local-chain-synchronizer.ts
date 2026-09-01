import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  anvilChain,
  corporateActionControllerWriteAbi,
  issuanceControllerWriteAbi,
  recoveryControllerWriteAbi,
  redemptionControllerWriteAbi,
  writeCorporateActionController,
  writeIssuanceController,
  writeRecoveryController,
  writeRedemptionController,
  writeSecondarySettlement,
  type LocalDeploymentManifest,
} from "@rwa/contracts-client";
import {
  beginChainExecution,
  markChainConfirmed,
  markChainFailed,
  markChainSubmitted,
} from "@rwa/database";
import type { Pool } from "pg";
import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  parseAbi,
  stringToHex,
  type Abi,
  type Address,
  type Hex,
  type TransactionReceipt,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const DEFAULT_ANVIL_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex;

function uuid16(value: string): Hex {
  const compact = value.replaceAll("-", "");
  if (!/^[0-9a-fA-F]{32}$/.test(compact)) throw new Error(`업무 UUID가 올바르지 않다: ${value}`);
  return `0x${compact}`;
}

function evidence(value: string): Hex {
  return `0x${createHash("sha256").update(value).digest("hex")}`;
}

function receiptJson(receipt: TransactionReceipt) {
  return JSON.parse(JSON.stringify(receipt, (_, value) => (typeof value === "bigint" ? value.toString() : value)));
}

function intentTuple(message: Record<string, string>, idFields: string[], numberFields: string[]) {
  return Object.fromEntries(
    Object.entries(message).map(([key, value]) => [
      key,
      idFields.includes(key) ? uuid16(value) : numberFields.includes(key) ? BigInt(value) : value,
    ]),
  );
}

export class LocalChainSynchronizer {
  private constructor(
    private readonly pool: Pool,
    private readonly manifest: LocalDeploymentManifest,
    private readonly wallet: ReturnType<typeof createWalletClient>,
    private readonly publicClient: ReturnType<typeof createPublicClient>,
  ) {}

  static async create(pool: Pool, environment: NodeJS.ProcessEnv) {
    const path = environment.LOCAL_CHAIN_MANIFEST_PATH ?? resolve(process.cwd(), ".runtime/local-deployment.json");
    const manifest = JSON.parse(await readFile(path, "utf8")) as LocalDeploymentManifest;
    if (manifest.chainId !== 31337 || !manifest.simulation)
      throw new Error("로컬 생애주기는 Anvil 합성 배포정보만 사용할 수 있다.");
    const privateKey = (environment.LOCAL_CHAIN_EXECUTOR_PRIVATE_KEY ?? DEFAULT_ANVIL_KEY) as Hex;
    const account = privateKeyToAccount(privateKey);
    const transport = http(environment.CHAIN_RPC_URL ?? manifest.rpcUrl);
    return new LocalChainSynchronizer(
      pool,
      manifest,
      createWalletClient({ account, chain: anvilChain, transport }),
      createPublicClient({ chain: anvilChain, transport }),
    );
  }

  private async run(
    workflowId: string,
    stage: string,
    contractAddress: Address,
    functionName: string,
    submit: () => Promise<Hex>,
  ): Promise<Hex> {
    const now = new Date();
    const started = await beginChainExecution(this.pool, {
      workflowId,
      stage,
      contractAddress,
      functionName,
      now,
    });
    if (!started.execute && started.record.transactionHash)
      return started.record.transactionHash as Hex;
    if (started.record.status === "SUBMITTED" || started.record.status === "UNCERTAIN") {
      const knownHash = started.record.transactionHash as Hex | undefined;
      if (knownHash) {
        const receipt = await this.publicClient.getTransactionReceipt({ hash: knownHash }).catch(() => undefined);
        if (receipt?.status === "success") {
          await markChainConfirmed(this.pool, {
            workflowId,
            stage,
            transactionHash: knownHash,
            receipt: receiptJson(receipt),
            now: new Date(),
          });
          return knownHash;
        }
        throw new Error(`미확정 거래를 임의 재전송하지 않는다: ${workflowId}/${stage}`);
      }
    }
    let hash: Hex | undefined;
    try {
      hash = await submit();
      const transaction = await this.publicClient.getTransaction({ hash });
      await markChainSubmitted(this.pool, {
        workflowId,
        stage,
        transactionHash: hash,
        nonce: BigInt(transaction.nonce),
        now: new Date(),
      });
      const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error(`${functionName} 거래가 되돌려졌다.`);
      await markChainConfirmed(this.pool, {
        workflowId,
        stage,
        transactionHash: hash,
        receipt: receiptJson(receipt),
        now: new Date(),
      });
      return hash;
    } catch (error) {
      await markChainFailed(this.pool, {
        workflowId,
        stage,
        status: hash ? "UNCERTAIN" : "FAILED",
        reason: error instanceof Error ? error.message : String(error),
        ...(hash ? { transactionHash: hash } : {}),
        now: new Date(),
      });
      throw error;
    }
  }

  private write(address: Address, abi: Abi, functionName: string, args: readonly unknown[]) {
    if (!this.wallet.account) throw new Error("로컬 체인 실행 계정이 없다.");
    return this.wallet.writeContract({ address, abi, functionName, args, account: this.wallet.account, chain: anvilChain } as never);
  }

  async synchronize(workflowId: string) {
    const type = await this.pool.query<{ workflow_type: string }>(
      "SELECT workflow_type FROM workflows WHERE workflow_id=$1",
      [workflowId],
    );
    const workflowType = type.rows[0]?.workflow_type;
    if (workflowType === "PRIMARY_ISSUANCE") await this.synchronizePrimary(workflowId);
    else if (workflowType === "REDEMPTION") await this.synchronizeRedemption(workflowId);
    else if (workflowType === "MARKET_MAKER_HEDGE") await this.synchronizeHedge(workflowId);
    else if (workflowType === "WALLET_REPLACEMENT") await this.synchronizeRecovery(workflowId);
    else if (workflowType === "CORPORATE_ACTION") await this.synchronizeCorporateAction(workflowId);
  }

  async executeSecondary(workflowId: string, payload: Record<string, unknown>): Promise<string> {
    const signedIntent = payload.signed_intent as { message?: Record<string, string>; signature?: Hex };
    const signedQuote = payload.signed_quote as { message?: Record<string, string>; signature?: Hex };
    const signedApproval = payload.signed_broker_approval as { message?: Record<string, string>; signature?: Hex };
    if (!signedIntent?.message || !signedIntent.signature || !signedQuote?.message || !signedQuote.signature || !signedApproval?.message || !signedApproval.signature)
      throw new Error("24시간 정산의 세 서명자료가 없다.");
    const controller = this.manifest.contracts.secondarySettlementController;
    const functionName = payload.funding_mode === "USDC_ONCHAIN" ? "settleUsdc" : "settleUsdLedger";
    return this.run(workflowId, "SECONDARY_SETTLEMENT", controller, functionName, () =>
      writeSecondarySettlement(this.wallet, {
        controller,
        functionName,
        args: [
          uuid16(workflowId),
          intentTuple(signedIntent.message!, ["orderId", "quoteId"], ["shareQuantity", "paymentAmountMinor", "nonce", "expiresAt"]),
          signedIntent.signature!,
          intentTuple(signedQuote.message!, ["quoteId"], ["shareQuantity", "unitPriceMinor", "nonce", "expiresAt"]),
          signedQuote.signature!,
          intentTuple(signedApproval.message!, ["approvalId", "orderId"], ["shareQuantity", "paymentAmountMinor", "nonce", "expiresAt"]),
          signedApproval.signature!,
          BigInt(String(payload.fill_quantity)),
          BigInt(String(payload.payment_amount_minor)),
        ],
      }),
    );
  }

  async executeEligibility(workflowId: string, walletAddress: Address, validUntil: Date) {
    const registry = this.manifest.contracts.eligibilityRegistry;
    const abi = parseAbi([
      "function setEligibility(bytes16 workflowId,address wallet,bool eligible,uint256 validUntil,bytes32 evidenceHash)",
    ]);
    return this.run(workflowId, "ELIGIBILITY_REGISTERED", registry, "setEligibility", () =>
      this.write(registry, abi, "setEligibility", [
        uuid16(workflowId),
        walletAddress,
        true,
        BigInt(Math.floor(validUntil.getTime() / 1000)),
        evidence(`${workflowId}:${walletAddress}:${validUntil.toISOString()}`),
      ]),
    );
  }

  private async synchronizePrimary(workflowId: string) {
    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT orders.*,facts.*,workflows.request_payload,instrument.token_address,
        batches.filled_quantity AS batch_filled_quantity
       FROM primary_orders orders
       JOIN primary_approval_facts facts ON facts.order_id=orders.order_id
       JOIN workflows ON workflows.workflow_id=orders.order_id
       JOIN local_simulation_instruments instrument USING (security_id)
       LEFT JOIN primary_batches batches ON batches.batch_id=orders.batch_id
       WHERE orders.order_id=$1`,
      [workflowId],
    );
    const row = result.rows[0];
    if (!row || !row.token_address) return;
    const controller = this.manifest.contracts.issuanceController;
    const token = String(row.token_address) as Address;
    const investor = String(row.wallet_address) as Address;
    const quantity = BigInt(String(row.allocated_quantity));
    if (!row.rights_recorded || quantity === 0n) return;
    const payload = row.request_payload as { signedIntent?: { message?: Record<string, string>; signature?: Hex } };
    const signed = payload.signedIntent;
    if (!signed?.message || !signed.signature) throw new Error("1차 발행 투자자 서명자료가 없다.");
    const workflow = uuid16(workflowId);
    const calls: Array<[string, string, readonly unknown[]]> = [
      ["PRIMARY_EXECUTION_ALLOCATION", "confirmExecutionAllocation", [workflow, token, investor, BigInt(String(row.batch_filled_quantity ?? quantity)), quantity, row.execution_evidence_hash, row.allocation_evidence_hash]],
      ["PRIMARY_T2_RISK", "approveT2Risk", [workflow, token, investor, quantity, row.risk_evidence_hash]],
      ["PRIMARY_RIGHTS_APPROVAL", "approveRightsEntry", [workflow, token, investor, quantity, row.rights_approval_evidence_hash]],
      ["PRIMARY_RIGHTS_RECORDED", "confirmRightsRecorded", [workflow, token, investor, quantity, row.rights_recorded_evidence_hash]],
      ["PRIMARY_PENDING_MINT", "executePendingMint", [workflow, intentTuple(signed.message, ["orderId"], ["shareQuantity", "krwLimitPrice", "fundingAmountMinor", "nonce", "expiresAt"]), signed.signature]],
    ];
    let mintHash: Hex | undefined;
    for (const [stage, functionName, args] of calls)
      mintHash = await this.run(workflowId, stage, controller, functionName, () =>
        writeIssuanceController(this.wallet, { controller, functionName: functionName as never, args }),
      );
    await this.pool.query("UPDATE primary_orders SET token_transaction_hash=$2 WHERE order_id=$1", [workflowId, mintHash]);

    if (row.domestic_settlement_confirmed && row.custody_quantity_confirmed) {
      const releaseCalls: Array<[string, string, readonly unknown[]]> = [
        ["PRIMARY_DOMESTIC_SETTLEMENT", "confirmDomesticSettlement", [workflow, token, investor, quantity, row.settlement_evidence_hash]],
        ["PRIMARY_CUSTODY", "confirmCustodyQuantity", [workflow, token, investor, quantity, row.custody_evidence_hash]],
        ["PRIMARY_RELEASE", "executeRelease", [workflow, token, investor, quantity]],
      ];
      let releaseHash: Hex | undefined;
      for (const [stage, functionName, args] of releaseCalls)
        releaseHash = await this.run(workflowId, stage, controller, functionName, () =>
          writeIssuanceController(this.wallet, { controller, functionName: functionName as never, args }),
        );
      await this.pool.query("UPDATE primary_orders SET release_transaction_hash=$2 WHERE order_id=$1", [workflowId, releaseHash]);
    }
  }

  private async synchronizeRedemption(workflowId: string) {
    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT orders.*,workflows.request_payload,instrument.token_address
       FROM redemption_orders orders JOIN workflows ON workflows.workflow_id=orders.redemption_id
       JOIN local_simulation_instruments instrument USING (security_id) WHERE orders.redemption_id=$1`,
      [workflowId],
    );
    const row = result.rows[0];
    if (!row?.token_address) return;
    const controller = this.manifest.contracts.redemptionController;
    const workflow = uuid16(workflowId);
    const token = String(row.token_address) as Address;
    const investor = String(row.wallet_address) as Address;
    const payload = row.request_payload as { signedIntent?: { message?: Record<string, string>; signature?: Hex } };
    const signed = payload.signedIntent;
    if (!signed?.message || !signed.signature) return;
    await this.run(workflowId, "REDEMPTION_LOCK", controller, "lockRedemption", () =>
      writeRedemptionController(this.wallet, {
        controller,
        functionName: "lockRedemption",
        args: [workflow, intentTuple(signed.message!, ["redemptionId"], ["shareQuantity", "krwLimitPrice", "nonce", "expiresAt"]), signed.signature!],
      }),
    );
    if (row.domestic_execution_confirmed) {
      await this.run(workflowId, "REDEMPTION_DOMESTIC_SUBMITTED", controller, "markDomesticSaleSubmitted", () =>
        writeRedemptionController(this.wallet, { controller, functionName: "markDomesticSaleSubmitted", args: [workflow, evidence(`${workflowId}:DOMESTIC_SUBMITTED`)] }),
      );
      await this.run(workflowId, "REDEMPTION_EXECUTION", controller, "confirmDomesticExecution", () =>
        writeRedemptionController(this.wallet, { controller, functionName: "confirmDomesticExecution", args: [workflow, BigInt(String(row.allocated_quantity)), evidence(`${workflowId}:EXECUTION`)] }),
      );
    }
    if (row.sale_proceeds_settled && BigInt(String(row.allocated_quantity)) > 0n) {
      await this.run(workflowId, "REDEMPTION_T2", controller, "confirmSaleProceedsSettled", () =>
        writeRedemptionController(this.wallet, { controller, functionName: "confirmSaleProceedsSettled", args: [workflow, BigInt(String(row.allocated_quantity)), BigInt(String(row.cash_claim_usd_minor ?? 1)), evidence(`${workflowId}:T2`)] }),
      );
    }
    if (row.rights_terminated && row.cash_claim_usd_minor) {
      const quantity = BigInt(String(row.allocated_quantity));
      const amount = BigInt(String(row.cash_claim_usd_minor));
      const calls: Array<[string, string, readonly unknown[]]> = [
        ["REDEMPTION_RIGHTS_TERMINATED", "confirmRightsTerminated", [workflow, token, investor, quantity, evidence(`${workflowId}:RIGHTS_TERMINATED`)]],
        ["REDEMPTION_CASH_CLAIM", "confirmCashClaim", [workflow, quantity, amount, evidence(`${workflowId}:CASH_CLAIM`)]],
        ["REDEMPTION_BURN_PENDING", "markBurnPending", [workflow]],
      ];
      for (const [stage, functionName, args] of calls)
        await this.run(workflowId, stage, controller, functionName, () => writeRedemptionController(this.wallet, { controller, functionName: functionName as never, args }));
    }
    if (row.token_burned && row.cash_claim_usd_minor) {
      const amount = BigInt(String(row.cash_claim_usd_minor));
      await this.run(workflowId, "REDEMPTION_PAYMENT_APPROVED", controller, "approveUsdPayment", () =>
        writeRedemptionController(this.wallet, { controller, functionName: "approveUsdPayment", args: [workflow, amount, evidence(`${workflowId}:PAYMENT`)] }),
      );
      const burnHash = await this.run(workflowId, "REDEMPTION_BURN", controller, "executeBurn", () =>
        writeRedemptionController(this.wallet, { controller, functionName: "executeBurn", args: [workflow] }),
      );
      await this.pool.query("UPDATE redemption_orders SET burn_evidence_hash=$2 WHERE redemption_id=$1", [workflowId, burnHash]);
    }
  }

  private async synchronizeRecovery(workflowId: string) {
    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT recovery.*,instrument.token_address FROM wallet_recoveries recovery
       JOIN local_simulation_instruments instrument ON instrument.security_id='990001'
       WHERE recovery.workflow_id=$1`,
      [workflowId],
    );
    const row = result.rows[0];
    if (!row?.rights_approved || !row.compliance_approved || !row.token_address) return;
    const controller = this.manifest.contracts.recoveryController;
    const token = String(row.token_address) as Address;
    const oldWallet = String(row.old_wallet) as Address;
    const newWallet = String(row.new_wallet) as Address;
    const workflow = uuid16(workflowId);
    const tokenAbi = parseAbi(["function freezeAddress(bytes16 workflowId,address account,bool frozen,bytes32 evidenceHash)"]);
    await this.run(workflowId, "RECOVERY_OLD_WALLET_FROZEN", token, "freezeAddress", () => this.write(token, tokenAbi, "freezeAddress", [workflow, oldWallet, true, evidence(`${workflowId}:FREEZE`)]));
    await this.run(workflowId, "RECOVERY_RIGHTS_APPROVAL", controller, "approveRightsRecovery", () => writeRecoveryController(this.wallet, { controller, functionName: "approveRightsRecovery", args: [workflow, oldWallet, newWallet, evidence(`${workflowId}:RIGHTS`)] }));
    await this.run(workflowId, "RECOVERY_COMPLIANCE_APPROVAL", controller, "approveComplianceRecovery", () => writeRecoveryController(this.wallet, { controller, functionName: "approveComplianceRecovery", args: [workflow, oldWallet, newWallet, evidence(`${workflowId}:COMPLIANCE`)] }));
    const hash = await this.run(workflowId, "RECOVERY_EXECUTED", controller, "executeRecovery", () => writeRecoveryController(this.wallet, { controller, functionName: "executeRecovery", args: [workflow, token, oldWallet, newWallet] }));
    await this.pool.query(
      `UPDATE wallet_recoveries SET chain_executed=true,reconciled=true,
       status='RECOVERY_COMPLETED',transaction_hash=$2,updated_at=$3 WHERE workflow_id=$1`,
      [workflowId, hash, new Date()],
    );
    await this.pool.query("UPDATE workflows SET status='RECOVERY_COMPLETED',updated_at=$2 WHERE workflow_id=$1", [workflowId, new Date()]);
  }

  private async synchronizeHedge(workflowId: string) {
    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT hedge.*,instrument.token_address FROM market_maker_hedges hedge
       JOIN local_simulation_instruments instrument USING (security_id) WHERE hedge.hedge_id=$1`,
      [workflowId],
    );
    const row = result.rows[0];
    if (!row?.token_address || !row.signed_intent || BigInt(String(row.filled_quantity)) === 0n) return;
    const signed = row.signed_intent as { message?: Record<string, string>; signature?: Hex };
    if (!signed.message || !signed.signature) return;
    const workflow = uuid16(workflowId);
    const token = String(row.token_address) as Address;
    const marketMaker = this.manifest.wallets.marketMaker;
    const quantity = BigInt(String(row.filled_quantity));
    if (row.direction === "BUY") {
      const controller = this.manifest.contracts.issuanceController;
      const calls: Array<[string, string, readonly unknown[]]> = [
        ["HEDGE_BUY_EXECUTION", "confirmExecutionAllocation", [workflow, token, marketMaker, quantity, quantity, evidence(`${workflowId}:EXECUTION`), evidence(`${workflowId}:ALLOCATION`)]],
        ["HEDGE_BUY_RISK", "approveT2Risk", [workflow, token, marketMaker, quantity, evidence(`${workflowId}:RISK`)]],
        ["HEDGE_BUY_RIGHTS_APPROVAL", "approveRightsEntry", [workflow, token, marketMaker, quantity, evidence(`${workflowId}:RIGHTS_APPROVAL`)]],
        ["HEDGE_BUY_RIGHTS_RECORDED", "confirmRightsRecorded", [workflow, token, marketMaker, quantity, evidence(`${workflowId}:RIGHTS_RECORDED`)]],
        ["HEDGE_BUY_PENDING_MINT", "executePendingMint", [workflow, intentTuple(signed.message, ["orderId"], ["shareQuantity", "krwLimitPrice", "fundingAmountMinor", "nonce", "expiresAt"]), signed.signature]],
      ];
      let finalHash: Hex | undefined;
      for (const [stage, functionName, args] of calls)
        finalHash = await this.run(workflowId, stage, controller, functionName, () => writeIssuanceController(this.wallet, { controller, functionName: functionName as never, args }));
      if (row.domestic_settlement_confirmed && row.custody_quantity_confirmed) {
        for (const [stage, functionName, args] of [
          ["HEDGE_BUY_SETTLEMENT", "confirmDomesticSettlement", [workflow, token, marketMaker, quantity, evidence(`${workflowId}:SETTLEMENT`)]],
          ["HEDGE_BUY_CUSTODY", "confirmCustodyQuantity", [workflow, token, marketMaker, quantity, evidence(`${workflowId}:CUSTODY`)]],
          ["HEDGE_BUY_RELEASE", "executeRelease", [workflow, token, marketMaker, quantity]],
        ] as Array<[string, string, readonly unknown[]]>)
          finalHash = await this.run(workflowId, stage, controller, functionName, () => writeIssuanceController(this.wallet, { controller, functionName: functionName as never, args }));
      }
      await this.pool.query("UPDATE market_maker_hedges SET token_transaction_hash=$2 WHERE hedge_id=$1", [workflowId, finalHash]);
    } else if (row.direction === "SELL") {
      const controller = this.manifest.contracts.redemptionController;
      const amount = BigInt(String(row.cash_claim_usd_minor ?? 1));
      const calls: Array<[string, string, readonly unknown[]]> = [
        ["HEDGE_SELL_LOCK", "lockRedemption", [workflow, intentTuple(signed.message, ["redemptionId"], ["shareQuantity", "krwLimitPrice", "nonce", "expiresAt"]), signed.signature]],
        ["HEDGE_SELL_SUBMITTED", "markDomesticSaleSubmitted", [workflow, evidence(`${workflowId}:SUBMITTED`)]],
        ["HEDGE_SELL_EXECUTION", "confirmDomesticExecution", [workflow, quantity, evidence(`${workflowId}:EXECUTION`)]],
        ["HEDGE_SELL_T2", "confirmSaleProceedsSettled", [workflow, quantity, amount, evidence(`${workflowId}:T2`)]],
        ["HEDGE_SELL_RIGHTS", "confirmRightsTerminated", [workflow, token, marketMaker, quantity, evidence(`${workflowId}:RIGHTS`)]],
        ["HEDGE_SELL_CLAIM", "confirmCashClaim", [workflow, quantity, amount, evidence(`${workflowId}:CLAIM`)]],
        ["HEDGE_SELL_BURN_PENDING", "markBurnPending", [workflow]],
        ["HEDGE_SELL_PAYMENT", "approveUsdPayment", [workflow, amount, evidence(`${workflowId}:PAYMENT`)]],
        ["HEDGE_SELL_BURN", "executeBurn", [workflow]],
      ];
      let finalHash: Hex | undefined;
      for (const [stage, functionName, args] of calls)
        finalHash = await this.run(workflowId, stage, controller, functionName, () => writeRedemptionController(this.wallet, { controller, functionName: functionName as never, args }));
      await this.pool.query("UPDATE market_maker_hedges SET token_transaction_hash=$2 WHERE hedge_id=$1", [workflowId, finalHash]);
    }
  }

  private async synchronizeCorporateAction(workflowId: string) {
    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT action.*,instrument.token_address FROM corporate_actions action
       JOIN local_simulation_instruments instrument USING (security_id) WHERE action.action_id=$1`,
      [workflowId],
    );
    const row = result.rows[0];
    if (!row?.rights_approved || !row.audit_approved || !row.token_address) return;
    const controller = this.manifest.contracts.corporateActionController;
    const token = String(row.token_address) as Address;
    const workflow = uuid16(workflowId);
    const policy = this.manifest.contracts.marketPolicyRegistry;
    const policyAbi = parseAbi(["function pauseScope(bytes16 workflowId,address token,bytes32 scope,bytes32 reasonCode,bytes32 evidenceHash)"]);
    for (const scopeName of ["ISSUANCE", "SECONDARY", "REDEMPTION"])
      await this.run(workflowId, `CORPORATE_PAUSE_${scopeName}`, policy, "pauseScope", () => this.write(policy, policyAbi, "pauseScope", [workflow, token, keccak256(stringToHex(scopeName)), evidence(`${workflowId}:CORPORATE_ACTION`), evidence(`${workflowId}:PAUSE:${scopeName}`)]));
    const accounts = await this.pool.query<{ wallet_address: string }>(
      `SELECT wallet.wallet_address FROM customer_rights_positions rights
       JOIN customer_wallets wallet ON wallet.principal_id=rights.principal_id AND wallet.active
       WHERE rights.security_id=$1 ORDER BY wallet.wallet_address`,
      [row.security_id],
    );
    const plan = [workflow, token, BigInt(String(row.numerator)), BigInt(String(row.denominator)), BigInt(String(row.expected_supply))] as const;
    await this.run(workflowId, "CORPORATE_RIGHTS_APPROVAL", controller, "approveRightsPlan", () => writeCorporateActionController(this.wallet, { controller, functionName: "approveRightsPlan", args: [...plan, evidence(`${workflowId}:RIGHTS_PLAN`)] }));
    await this.run(workflowId, "CORPORATE_AUDIT_APPROVAL", controller, "approveAuditPlan", () => writeCorporateActionController(this.wallet, { controller, functionName: "approveAuditPlan", args: [...plan, evidence(`${workflowId}:AUDIT_PLAN`)] }));
    await this.run(workflowId, "CORPORATE_SPLIT_APPLIED", controller, "applySplitBatch", () => writeCorporateActionController(this.wallet, { controller, functionName: "applySplitBatch", args: [workflow, token, accounts.rows.map((item) => item.wallet_address as Address)] }));
    const hash = await this.run(workflowId, "CORPORATE_SPLIT_FINALIZED", controller, "finalizeSplit", () => writeCorporateActionController(this.wallet, { controller, functionName: "finalizeSplit", args: [workflow] }));
    await this.pool.query(
      `UPDATE corporate_actions SET token_applied=true,reconciled=true,
       status='CORPORATE_ACTION_RECONCILED',transaction_hash=$2,updated_at=$3 WHERE action_id=$1`,
      [workflowId, hash, new Date()],
    );
    await this.pool.query("UPDATE workflows SET status='CORPORATE_ACTION_RECONCILED',updated_at=$2 WHERE workflow_id=$1", [workflowId, new Date()]);
  }
}
