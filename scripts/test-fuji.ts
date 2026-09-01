import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  encodeFunctionData,
  keccak256,
  padHex,
  parseAbi,
  stringToHex,
  type Abi,
  type Address,
  type Hex,
} from "viem";

import {
  OFFICIAL_FUJI_RPC,
  artifact,
  currentCommit,
  estimateFujiGas,
  evidence,
  explorerAddress,
  explorerTransaction,
  fujiChain,
  fujiTransport,
  loadFujiAccounts,
  loadOfficialIsins,
  role,
  root,
  workflow,
  type RoleAlias,
} from "./fuji-common.js";

type Deployment = {
  simulation: true;
  chainId: 43113;
  gitCommit: string;
  officialIsinEvidenceSha256: string;
  status: "COMPLETE";
  contracts: Record<string, Address>;
  safe: Address;
  tokens: Record<string, Address>;
  transactions: Record<string, Hex>;
  policyVersion: Hex;
  governance: { safe: Address; timelock: Address; threshold: 2; minimumDelaySeconds: 60 };
  designVersion: Hex;
};

const primaryTypes = {
  PrimaryOrderIntent: [
    { name: "orderId", type: "bytes16" },
    { name: "investor", type: "address" },
    { name: "securityId", type: "string" },
    { name: "shareQuantity", type: "uint256" },
    { name: "krwLimitPrice", type: "uint256" },
    { name: "targetTradingDate", type: "string" },
    { name: "fundingMode", type: "string" },
    { name: "fundingAmountMinor", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "expiresAt", type: "uint256" },
    { name: "policyVersion", type: "bytes32" },
  ],
} as const;
const secondaryTypes = {
  SecondaryOrderIntent: [
    { name: "orderId", type: "bytes16" }, { name: "quoteId", type: "bytes16" },
    { name: "investor", type: "address" }, { name: "token", type: "address" },
    { name: "investorSide", type: "string" }, { name: "paymentMode", type: "string" },
    { name: "paymentAssetId", type: "bytes32" }, { name: "shareQuantity", type: "uint256" },
    { name: "paymentAmountMinor", type: "uint256" }, { name: "nonce", type: "uint256" },
    { name: "expiresAt", type: "uint256" }, { name: "policyVersion", type: "bytes32" },
  ],
  MarketMakerQuote: [
    { name: "quoteId", type: "bytes16" }, { name: "marketMaker", type: "address" },
    { name: "token", type: "address" }, { name: "marketMakerSide", type: "string" },
    { name: "paymentMode", type: "string" }, { name: "paymentAssetId", type: "bytes32" },
    { name: "shareQuantity", type: "uint256" }, { name: "unitPriceMinor", type: "uint256" },
    { name: "nonce", type: "uint256" }, { name: "expiresAt", type: "uint256" },
    { name: "policyVersion", type: "bytes32" },
  ],
  BrokerSettlementApproval: [
    { name: "approvalId", type: "bytes16" }, { name: "orderId", type: "bytes16" },
    { name: "investor", type: "address" }, { name: "marketMaker", type: "address" },
    { name: "token", type: "address" }, { name: "paymentMode", type: "string" },
    { name: "paymentAssetId", type: "bytes32" }, { name: "shareQuantity", type: "uint256" },
    { name: "paymentAmountMinor", type: "uint256" }, { name: "rightsEvidenceHash", type: "bytes32" },
    { name: "fundsEvidenceHash", type: "bytes32" }, { name: "nonce", type: "uint256" },
    { name: "expiresAt", type: "uint256" }, { name: "policyVersion", type: "bytes32" },
  ],
} as const;
const redemptionTypes = {
  RedemptionIntent: [
    { name: "redemptionId", type: "bytes16" }, { name: "investor", type: "address" },
    { name: "token", type: "address" }, { name: "shareQuantity", type: "uint256" },
    { name: "krwLimitPrice", type: "uint256" }, { name: "targetTradingDate", type: "string" },
    { name: "nonce", type: "uint256" }, { name: "expiresAt", type: "uint256" },
    { name: "policyVersion", type: "bytes32" },
  ],
} as const;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  const rpcUrl = process.env.FUJI_RPC_URL?.trim() || OFFICIAL_FUJI_RPC;
  const deployment = JSON.parse(
    await readFile(resolve(root, ".runtime/fuji/deployment.json"), "utf8"),
  ) as Deployment;
  const official = await loadOfficialIsins();
  const accounts = await loadFujiAccounts();
  const gitCommit = await currentCommit();
  assert(deployment.status === "COMPLETE", "Fuji 배포가 완료되지 않았다.");
  assert(deployment.gitCommit === gitCommit, "로컬 검증·배포·Fuji 시험 커밋이 다르다.");
  assert(deployment.officialIsinEvidenceSha256 === official.evidenceSha256, "ISIN 증거가 배포 후 바뀌었다.");
  const transport = fujiTransport(rpcUrl);
  const publicClient = createPublicClient({ chain: fujiChain, transport });
  assert((await publicClient.getChainId()) === 43_113, "Fuji 체인 ID가 43113이 아니다.");
  const wallets = Object.fromEntries(
    Object.entries(accounts).map(([alias, account]) => [alias, createWalletClient({ account, chain: fujiChain, transport })]),
  ) as unknown as Record<RoleAlias, ReturnType<typeof createWalletClient>>;
  const receipts: Array<{ label: string; hash: Hex; blockNumber: string; explorer: string }> = [];
  const write = async (
    label: string,
    alias: RoleAlias,
    address: Address,
    abi: Abi,
    functionName: string,
    args: readonly unknown[],
  ) => {
    const data = encodeFunctionData({ abi, functionName, args } as never);
    const gas = await estimateFujiGas(rpcUrl, {
      from: accounts[alias].address,
      to: address,
      data,
    });
    const hash = await wallets[alias].writeContract({
      address, abi, functionName, args, gas, account: accounts[alias], chain: fujiChain,
    } as never);
    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 180_000 });
    assert(receipt.status === "success", `${label} 거래가 실패했다.`);
    receipts.push({ label, hash, blockNumber: receipt.blockNumber.toString(), explorer: explorerTransaction(hash) });
    return receipt;
  };

  const tokenArtifact = await artifact("RestrictedEquityToken");
  const factoryArtifact = await artifact("SecurityTokenFactory");
  const policyArtifact = await artifact("MarketPolicyRegistry");
  const accessAbi = parseAbi(["function hasRole(bytes32 role,address account) view returns (bool)"]);
  const safeAbi = parseAbi(["function getThreshold() view returns (uint256)", "function getOwners() view returns (address[])"]);
  const timelockAbi = parseAbi(["function getMinDelay() view returns (uint256)"]);
  const deploymentChecks = [];
  assert(new Set(Object.values(deployment.tokens).map((value) => value.toLowerCase())).size === 6, "대표 6종목 주소가 분리되지 않았다.");
  for (const security of official.securities) {
    const token = deployment.tokens[security.shortCode];
    assert(token, `${security.shortCode} 토큰 주소가 없다.`);
    const deployedCode = await publicClient.getCode({ address: token });
    assert(deployedCode && deployedCode !== "0x", `${security.shortCode} 토큰 코드가 없다.`);
    const scopes = Object.fromEntries(
      await Promise.all(
        ["ISSUANCE", "SECONDARY", "REDEMPTION", "USDC_PATH"].map(async (scope) => [
          scope,
          await publicClient.readContract({
            address: deployment.contracts.marketPolicyRegistry,
            abi: policyArtifact.abi,
            functionName: "isScopePaused",
            args: [token, keccak256(stringToHex(scope))],
          }),
        ]),
      ),
    );
    const registrationHash = deployment.transactions[`token:deploy:${security.shortCode}`];
    assert(registrationHash, `${security.shortCode} 등록 거래가 없다.`);
    const registrationReceipt = await publicClient.getTransactionReceipt({ hash: registrationHash });
    const registration = registrationReceipt.logs
      .map((log) => {
        try {
          return decodeEventLog({ abi: factoryArtifact.abi, data: log.data, topics: log.topics });
        } catch {
          return undefined;
        }
      })
      .find((event) => event?.eventName === "SecurityTokenRegistered");
    const registrationArgs = registration?.args as { krxCode?: string; isin?: string; token?: Address } | undefined;
    assert(
      registrationArgs?.krxCode === security.shortCode &&
        registrationArgs.isin === security.isin &&
        registrationArgs.token?.toLowerCase() === token.toLowerCase(),
      `${security.shortCode} 온체인 등록 종목코드 또는 ISIN이 다르다.`,
    );
    const [name, symbol, decimals, supply, code] = await Promise.all([
      publicClient.readContract({ address: token, abi: tokenArtifact.abi, functionName: "name" }),
      publicClient.readContract({ address: token, abi: tokenArtifact.abi, functionName: "symbol" }),
      publicClient.readContract({ address: token, abi: tokenArtifact.abi, functionName: "decimals" }),
      publicClient.readContract({ address: token, abi: tokenArtifact.abi, functionName: "totalSupply" }),
      publicClient.readContract({ address: deployment.contracts.securityTokenFactory, abi: factoryArtifact.abi, functionName: "getTokenSecurityId", args: [token] }),
    ]);
    assert(name === `모의 ${security.itemName} 수탁권리 (Fuji)`, `${security.shortCode} 토큰명이 다르다.`);
    assert(symbol === `SIM${security.shortCode}`, `${security.shortCode} 심볼이 다르다.`);
    assert(decimals === 0, `${security.shortCode} 소수점이 0이 아니다.`);
    assert(supply === 0n, `${security.shortCode} 초기 공급량이 0이 아니다.`);
    assert(code === security.shortCode, `${security.shortCode} 팩토리 식별자가 다르다.`);
    deploymentChecks.push({
      ...security,
      token,
      name,
      symbol,
      decimals,
      supply: supply.toString(),
      runtimeCodeHash: keccak256(deployedCode),
      policyScopes: scopes,
      registrationTransaction: registrationHash,
      explorer: explorerAddress(token),
    });
  }
  const [safeThreshold, safeOwners, delay] = await Promise.all([
    publicClient.readContract({ address: deployment.safe, abi: safeAbi, functionName: "getThreshold" }),
    publicClient.readContract({ address: deployment.safe, abi: safeAbi, functionName: "getOwners" }),
    publicClient.readContract({ address: deployment.contracts.timelock, abi: timelockAbi, functionName: "getMinDelay" }),
  ]);
  assert(safeThreshold === 2n && safeOwners.length === 3, "Safe 2-of-3 설정이 아니다.");
  assert(
    new Set(safeOwners.map((owner) => owner.toLowerCase())).size === 3 &&
      [accounts.safeOwner1, accounts.safeOwner2, accounts.safeOwner3].every((account) =>
        safeOwners.some((owner) => owner.toLowerCase() === account.address.toLowerCase()),
      ),
    "Safe 소유자 구성이 로컬 시험 키와 다르다.",
  );
  assert(delay === 60n, "지연 실행 시간이 60초가 아니다.");
  for (const address of [
    deployment.contracts.eligibilityRegistry,
    deployment.contracts.marketPolicyRegistry,
    deployment.contracts.intentVerifier,
    deployment.contracts.securityTokenFactory,
    deployment.contracts.issuanceController,
    deployment.contracts.secondarySettlementController,
    deployment.contracts.redemptionController,
    deployment.contracts.recoveryController,
    deployment.contracts.corporateActionController,
    ...Object.values(deployment.tokens),
  ]) {
    const [timelockAdmin, deployerAdmin] = await Promise.all([
      publicClient.readContract({ address, abi: accessAbi, functionName: "hasRole", args: [`0x${"00".repeat(32)}`, deployment.contracts.timelock] }),
      publicClient.readContract({ address, abi: accessAbi, functionName: "hasRole", args: [`0x${"00".repeat(32)}`, accounts.deployer.address] }),
    ]);
    assert(timelockAdmin === true && deployerAdmin === false, "관리자 권한 이전 또는 포기가 완료되지 않았다.");
  }
  const operationalRoles: Array<[Address, string, Address]> = [
    [deployment.contracts.issuanceController, "EXECUTION_ALLOCATION_CONFIRMER_ROLE", accounts.executionConfirmer.address],
    [deployment.contracts.issuanceController, "RISK_APPROVER_ROLE", accounts.riskApprover.address],
    [deployment.contracts.issuanceController, "RIGHTS_ENTRY_APPROVER_ROLE", accounts.rightsEntryApprover.address],
    [deployment.contracts.issuanceController, "RIGHTS_RECORDING_CONFIRMER_ROLE", accounts.rightsRecordingConfirmer.address],
    [deployment.contracts.issuanceController, "SETTLEMENT_CONFIRMER_ROLE", accounts.settlementConfirmer.address],
    [deployment.contracts.issuanceController, "CUSTODY_CONFIRMER_ROLE", accounts.custodyConfirmer.address],
    [deployment.contracts.issuanceController, "ISSUANCE_EXECUTOR_ROLE", accounts.issuanceExecutor.address],
    [deployment.contracts.secondarySettlementController, "SETTLEMENT_EXECUTOR_ROLE", accounts.secondaryExecutor.address],
    [deployment.contracts.redemptionController, "REDEMPTION_RIGHTS_APPROVER_ROLE", accounts.redemptionRightsApprover.address],
    [deployment.contracts.redemptionController, "SETTLEMENT_CONFIRMER_ROLE", accounts.settlementConfirmer.address],
    [deployment.contracts.redemptionController, "PAYMENT_APPROVER_ROLE", accounts.paymentApprover.address],
    [deployment.contracts.redemptionController, "REDEMPTION_EXECUTOR_ROLE", accounts.redemptionExecutor.address],
  ];
  assert(
    new Set(operationalRoles.map(([, , member]) => member.toLowerCase())).size ===
      new Set(operationalRoles.map(([, roleName]) => roleName)).size,
    "활성 Fuji 운영 역할이 서로 다른 시험 키로 분리되지 않았다.",
  );
  for (const [contract, roleName, member] of operationalRoles) {
    assert(
      (await publicClient.readContract({ address: contract, abi: accessAbi, functionName: "hasRole", args: [role(roleName), member] })) === true,
      `${roleName} 역할이 승인된 주소에 부여되지 않았다.`,
    );
  }

  const samsung = deployment.tokens["005930"]!;
  const directBefore = {
    investor: await publicClient.readContract({ address: samsung, abi: tokenArtifact.abi, functionName: "balanceOf", args: [accounts.investor.address] }),
    marketMaker: await publicClient.readContract({ address: samsung, abi: tokenArtifact.abi, functionName: "balanceOf", args: [accounts.marketMaker.address] }),
    supply: await publicClient.readContract({ address: samsung, abi: tokenArtifact.abi, functionName: "totalSupply" }),
  };
  const directTransferChecks = [];
  for (const [functionName, args] of [
    ["transfer", [accounts.marketMaker.address, 1n]],
    ["transferFrom", [accounts.investor.address, accounts.marketMaker.address, 1n]],
    ["approve", [accounts.marketMaker.address, 1n]],
  ] as const) {
    let blocked = false;
    try {
      await publicClient.simulateContract({
        account: accounts.investor,
        address: samsung,
        abi: tokenArtifact.abi,
        functionName,
        args,
      } as never);
    } catch {
      blocked = true;
      directTransferChecks.push({ functionName, blocked, errorCode: "DIRECT_ACTION_REVERTED" });
    }
    assert(blocked, `${functionName} 직접 호출이 차단되지 않았다.`);
  }
  const directAfter = {
    investor: await publicClient.readContract({ address: samsung, abi: tokenArtifact.abi, functionName: "balanceOf", args: [accounts.investor.address] }),
    marketMaker: await publicClient.readContract({ address: samsung, abi: tokenArtifact.abi, functionName: "balanceOf", args: [accounts.marketMaker.address] }),
    supply: await publicClient.readContract({ address: samsung, abi: tokenArtifact.abi, functionName: "totalSupply" }),
  };
  assert(
    directBefore.investor === directAfter.investor &&
      directBefore.marketMaker === directAfter.marketMaker &&
      directBefore.supply === directAfter.supply,
    "직접이전 차단 시험 전후 잔액 또는 공급량이 바뀌었다.",
  );

  const issuanceAbi = (await artifact("IssuanceController")).abi;
  const secondaryAbi = (await artifact("SecondarySettlementController")).abi;
  const redemptionAbi = (await artifact("RedemptionController")).abi;
  const usdcAbi = (await artifact("MockUsdc")).abi;
  const block = await publicClient.getBlock();
  const expiresAt = block.timestamp + 7_200n;
  const runSeed = `${gitCommit}:${block.number}`;
  const runWorkflow = (label: string) => workflow(`${runSeed}:${label}`);
  const runEvidence = (label: string) => evidence(`${runSeed}:${label}`);
  const nonceBase = block.number * 100n;
  const domain = {
    name: "Korean Equity RWA Intent",
    version: "1",
    chainId: 43_113,
    verifyingContract: deployment.contracts.intentVerifier,
  } as const;

  const issuanceId = runWorkflow("SAMSUNG_ISSUANCE");
  const primaryIntent = {
    orderId: issuanceId,
    investor: accounts.investor.address,
    securityId: "005930",
    shareQuantity: 1n,
    krwLimitPrice: 257_000n,
    targetTradingDate: "2026-08-28",
    fundingMode: "USD_LEDGER",
    fundingAmountMinor: 18_619n,
    nonce: nonceBase + 1n,
    expiresAt,
    policyVersion: deployment.policyVersion,
  };
  const primarySignature = await accounts.investor.signTypedData({
    domain, types: primaryTypes, primaryType: "PrimaryOrderIntent", message: primaryIntent,
  });
  await write("발행 체결·배분 확인", "executionConfirmer", deployment.contracts.issuanceController, issuanceAbi, "confirmExecutionAllocation", [issuanceId, samsung, accounts.investor.address, 1n, 1n, runEvidence("FUJI_EXECUTION"), runEvidence("FUJI_ALLOCATION")]);
  await write("T+2 위험 승인", "riskApprover", deployment.contracts.issuanceController, issuanceAbi, "approveT2Risk", [issuanceId, samsung, accounts.investor.address, 1n, runEvidence("FUJI_RISK")]);
  await write("권리기입 승인", "rightsEntryApprover", deployment.contracts.issuanceController, issuanceAbi, "approveRightsEntry", [issuanceId, samsung, accounts.investor.address, 1n, runEvidence("FUJI_RIGHTS_APPROVAL")]);
  await write("권리원장 반영 확인", "rightsRecordingConfirmer", deployment.contracts.issuanceController, issuanceAbi, "confirmRightsRecorded", [issuanceId, samsung, accounts.investor.address, 1n, runEvidence("FUJI_RIGHTS_RECORDED")]);
  await write("결제대기 발행", "issuanceExecutor", deployment.contracts.issuanceController, issuanceAbi, "executePendingMint", [issuanceId, primaryIntent, primarySignature]);
  assert((await publicClient.readContract({ address: samsung, abi: tokenArtifact.abi, functionName: "pendingSettlementBalanceOf", args: [accounts.investor.address] })) === 1n, "결제 대기 1주가 발행되지 않았다.");
  await write("국내 결제 확인", "settlementConfirmer", deployment.contracts.issuanceController, issuanceAbi, "confirmDomesticSettlement", [issuanceId, samsung, accounts.investor.address, 1n, runEvidence("FUJI_DOMESTIC_SETTLEMENT")]);
  await write("수탁수량 확인", "custodyConfirmer", deployment.contracts.issuanceController, issuanceAbi, "confirmCustodyQuantity", [issuanceId, samsung, accounts.investor.address, 1n, runEvidence("FUJI_CUSTODY")]);
  await write("거래 가능 전환", "issuanceExecutor", deployment.contracts.issuanceController, issuanceAbi, "executeRelease", [issuanceId, samsung, accounts.investor.address, 1n]);

  await write("시장조성자 Mock USDC 지급", "deployer", deployment.contracts.mockUsdc, usdcAbi, "mint", [accounts.marketMaker.address, 1_000_000n]);
  await write("시장조성자 Mock USDC 승인", "marketMaker", deployment.contracts.mockUsdc, usdcAbi, "approve", [deployment.contracts.secondarySettlementController, 1_000_000n]);
  const settlementId = runWorkflow("SAMSUNG_DVP");
  const quoteId = runWorkflow("SAMSUNG_QUOTE");
  const paymentAssetId = padHex(deployment.contracts.mockUsdc, { size: 32 });
  const order = { orderId: settlementId, quoteId, investor: accounts.investor.address, token: samsung, investorSide: "SELL", paymentMode: "USDC_ONCHAIN", paymentAssetId, shareQuantity: 1n, paymentAmountMinor: 1_000_000n, nonce: nonceBase + 2n, expiresAt, policyVersion: deployment.policyVersion };
  const quote = { quoteId, marketMaker: accounts.marketMaker.address, token: samsung, marketMakerSide: "BUY", paymentMode: "USDC_ONCHAIN", paymentAssetId, shareQuantity: 1n, unitPriceMinor: 1_000_000n, nonce: nonceBase + 3n, expiresAt, policyVersion: deployment.policyVersion };
  const approval = { approvalId: runWorkflow("SAMSUNG_APPROVAL"), orderId: settlementId, investor: accounts.investor.address, marketMaker: accounts.marketMaker.address, token: samsung, paymentMode: "USDC_ONCHAIN", paymentAssetId, shareQuantity: 1n, paymentAmountMinor: 1_000_000n, rightsEvidenceHash: runEvidence("FUJI_DVP_RIGHTS"), fundsEvidenceHash: runEvidence("FUJI_DVP_FUNDS"), nonce: nonceBase + 4n, expiresAt, policyVersion: deployment.policyVersion };
  const [investorSignature, marketMakerSignature, brokerSignature] = await Promise.all([
    accounts.investor.signTypedData({ domain, types: { SecondaryOrderIntent: secondaryTypes.SecondaryOrderIntent }, primaryType: "SecondaryOrderIntent", message: order }),
    accounts.marketMaker.signTypedData({ domain, types: { MarketMakerQuote: secondaryTypes.MarketMakerQuote }, primaryType: "MarketMakerQuote", message: quote }),
    accounts.brokerSigner.signTypedData({ domain, types: { BrokerSettlementApproval: secondaryTypes.BrokerSettlementApproval }, primaryType: "BrokerSettlementApproval", message: approval }),
  ]);
  await write("Mock USDC DvP", "secondaryExecutor", deployment.contracts.secondarySettlementController, secondaryAbi, "settleUsdc", [settlementId, order, investorSignature, quote, marketMakerSignature, approval, brokerSignature, 1n, 1_000_000n]);
  assert((await publicClient.readContract({ address: samsung, abi: tokenArtifact.abi, functionName: "availableBalanceOf", args: [accounts.marketMaker.address] })) === 1n, "시장조성자에게 토큰이 이전되지 않았다.");
  assert((await publicClient.readContract({ address: deployment.contracts.mockUsdc, abi: usdcAbi, functionName: "balanceOf", args: [accounts.investor.address] })) === 1_000_000n, "투자자에게 Mock USDC가 지급되지 않았다.");

  const redemptionId = runWorkflow("SAMSUNG_REDEMPTION");
  const redemptionIntent = { redemptionId, investor: accounts.marketMaker.address, token: samsung, shareQuantity: 1n, krwLimitPrice: 257_000n, targetTradingDate: "2026-08-28", nonce: nonceBase + 5n, expiresAt, policyVersion: deployment.policyVersion };
  const redemptionSignature = await accounts.marketMaker.signTypedData({ domain, types: redemptionTypes, primaryType: "RedemptionIntent", message: redemptionIntent });
  await write("환매 잠금", "redemptionExecutor", deployment.contracts.redemptionController, redemptionAbi, "lockRedemption", [redemptionId, redemptionIntent, redemptionSignature]);
  await write("국내 매도 제출", "redemptionRightsApprover", deployment.contracts.redemptionController, redemptionAbi, "markDomesticSaleSubmitted", [redemptionId, runEvidence("FUJI_REDEMPTION_SUBMITTED")]);
  await write("국내 매도 체결", "redemptionRightsApprover", deployment.contracts.redemptionController, redemptionAbi, "confirmDomesticExecution", [redemptionId, 1n, runEvidence("FUJI_REDEMPTION_EXECUTION")]);
  await write("매도대금 결제", "settlementConfirmer", deployment.contracts.redemptionController, redemptionAbi, "confirmSaleProceedsSettled", [redemptionId, 1n, 18_619n, runEvidence("FUJI_REDEMPTION_SETTLEMENT")]);
  await write("권리 종료", "redemptionRightsApprover", deployment.contracts.redemptionController, redemptionAbi, "confirmRightsTerminated", [redemptionId, samsung, accounts.marketMaker.address, 1n, runEvidence("FUJI_RIGHTS_TERMINATED")]);
  await write("USD 지급청구", "redemptionRightsApprover", deployment.contracts.redemptionController, redemptionAbi, "confirmCashClaim", [redemptionId, 1n, 18_619n, runEvidence("FUJI_CASH_CLAIM")]);
  await write("소각 대기", "redemptionExecutor", deployment.contracts.redemptionController, redemptionAbi, "markBurnPending", [redemptionId]);
  await write("USD 지급 승인", "paymentApprover", deployment.contracts.redemptionController, redemptionAbi, "approveUsdPayment", [redemptionId, 18_619n, runEvidence("FUJI_USD_PAYMENT")]);
  await write("환매 소각", "redemptionExecutor", deployment.contracts.redemptionController, redemptionAbi, "executeBurn", [redemptionId]);
  const finalSupply = await publicClient.readContract({ address: samsung, abi: tokenArtifact.abi, functionName: "totalSupply" });
  assert(finalSupply === 0n, "삼성전자 Fuji 시험의 마지막 공급량이 0이 아니다.");

  const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${gitCommit.slice(0, 8)}`;
  const outputDirectory = resolve(root, `docs/10-poc-implementation/evidence/fuji/${runId}`);
  const result = {
    schemaVersion: "1.0.0",
    simulation: true,
    network: { name: "Avalanche Fuji C-Chain", chainId: 43113, rpc: rpcUrl === OFFICIAL_FUJI_RPC ? OFFICIAL_FUJI_RPC : "custom-fuji-rpc" },
    gitCommit,
    officialIsinEvidenceSha256: official.evidenceSha256,
    mockPaymentAsset: { address: deployment.contracts.mockUsdc, name: "Mock USDC", decimals: 6, circleIssued: false },
    tests: [
      { testId: "Fuji-배포-01", status: "PASSED", securities: deploymentChecks, safe: { address: deployment.safe, threshold: safeThreshold.toString(), owners: safeOwners, minimumDelaySeconds: delay.toString() } },
      {
        testId: "Fuji-직접이전차단-01",
        status: "PASSED",
        checks: directTransferChecks,
        before: Object.fromEntries(Object.entries(directBefore).map(([key, value]) => [key, String(value)])),
        after: Object.fromEntries(Object.entries(directAfter).map(([key, value]) => [key, String(value)])),
      },
      { testId: "Fuji-생애주기-01", status: "PASSED", finalSupply: finalSupply.toString(), transactionLabels: receipts.map((item) => item.label) },
    ],
    receipts,
    boundary: "Fuji 온체인 통제와 모의 기관 증거 연결만 검증하며 고객 권리 원장 또는 법적 결제 완료를 뜻하지 않는다.",
  };
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(resolve(outputDirectory, "result.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(`Fuji 시험 3개를 모두 통과했다: ${outputDirectory}`);
}

await main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Fuji 시험을 완료하지 못했다: ${message}`);
  process.exitCode = 1;
});
