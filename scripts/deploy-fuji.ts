import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  encodeDeployData,
  encodeFunctionData,
  formatEther,
  keccak256,
  parseAbi,
  parseEther,
  type Abi,
  type Address,
  type Hex,
} from "viem";

import {
  FUJI_CHAIN_ID,
  OFFICIAL_FUJI_RPC,
  artifact,
  artifactBytecode,
  artifactRuntimeBytecode,
  currentCommit,
  estimateFujiGas,
  evidence,
  fujiChain,
  fujiTransport,
  loadFujiAccounts,
  loadOfficialIsins,
  role,
  roleAliases,
  root,
  workflow,
  type RoleAlias,
} from "./fuji-common.js";

type ContractName =
  | "safeSingleton"
  | "safeProxyFactory"
  | "timelock"
  | "eligibilityRegistry"
  | "marketPolicyRegistry"
  | "intentVerifier"
  | "securityTokenFactory"
  | "issuanceController"
  | "secondarySettlementController"
  | "redemptionController"
  | "recoveryController"
  | "corporateActionController"
  | "mockUsdc";

type Progress = {
  schemaVersion: "1.0.0";
  simulation: true;
  chainId: 43113;
  gitCommit: string;
  officialIsinEvidenceSha256: string;
  startedAt: string;
  updatedAt: string;
  status: "IN_PROGRESS" | "COMPLETE";
  deployer: Address;
  safeOwners: Address[];
  contracts: Partial<Record<ContractName, Address>>;
  safe?: Address;
  tokens: Record<string, Address>;
  transactions: Record<string, Hex>;
  policyVersion: Hex;
  resumedFromCommits?: string[];
};

const progressPath = resolve(root, ".runtime/fuji/deployment-progress.json");
const manifestPath = resolve(root, ".runtime/fuji/deployment.json");
const zeroAddress = "0x0000000000000000000000000000000000000000" as Address;
const defaultAdmin = `0x${"00".repeat(32)}` as Hex;
async function main() {
  const rpcUrl = process.env.FUJI_RPC_URL?.trim() || OFFICIAL_FUJI_RPC;
  const accounts = await loadFujiAccounts();
  const official = await loadOfficialIsins();
  const gitCommit = await currentCommit();
  const transport = fujiTransport(rpcUrl);
  const publicClient = createPublicClient({ chain: fujiChain, transport });
  if ((await publicClient.getChainId()) !== FUJI_CHAIN_ID) {
    throw new Error("Fuji 배포는 체인 ID 43113에서만 허용한다.");
  }
  const deployer = accounts.deployer;
  const deployerWallet = createWalletClient({ account: deployer, chain: fujiChain, transport });
  const gasPrice = await publicClient.getGasPrice();
  const conservativeGasUnits = 40_000_000n;
  const requiredBalance = (gasPrice * conservativeGasUnits * 130n) / 100n;
  const balance = await publicClient.getBalance({ address: deployer.address });
  if (balance < requiredBalance) {
    throw new Error(
      `Fuji 배포자 잔액이 부족하다. 현재 ${formatEther(balance)} AVAX, 보수적 필요액 ${formatEther(requiredBalance)} AVAX`,
    );
  }

  let progress: Progress;
  try {
    progress = JSON.parse(await readFile(progressPath, "utf8")) as Progress;
    if (
      progress.chainId !== FUJI_CHAIN_ID ||
      progress.officialIsinEvidenceSha256 !== official.evidenceSha256 ||
      progress.deployer.toLowerCase() !== deployer.address.toLowerCase()
    ) throw new Error("기존 Fuji 진행기록이 현재 ISIN, 체인 또는 배포자와 다르다.");
    if (progress.gitCommit !== gitCommit) {
      if (
        progress.status !== "IN_PROGRESS" ||
        Object.keys(progress.contracts).some(
          (key) => key !== "safeSingleton" && key !== "safeProxyFactory",
        ) ||
        progress.safe ||
        Object.keys(progress.tokens).length > 0
      ) throw new Error("계약 구성이 시작된 Fuji 진행기록은 다른 커밋에서 이어갈 수 없다.");
      const bootstrapArtifacts: Array<[ContractName, string, string]> = [
        [
          "safeSingleton",
          "SafeL2",
          "node_modules/@safe-global/safe-contracts/build/artifacts/contracts/SafeL2.sol/SafeL2.json",
        ],
        [
          "safeProxyFactory",
          "SafeProxyFactory",
          "node_modules/@safe-global/safe-contracts/build/artifacts/contracts/proxies/SafeProxyFactory.sol/SafeProxyFactory.json",
        ],
      ];
      for (const [key, name, path] of bootstrapArtifacts) {
        const address = progress.contracts[key];
        if (!address) continue;
        const [code, item] = await Promise.all([
          publicClient.getCode({ address }),
          artifact(name, path),
        ]);
        if (!code || code === "0x" || keccak256(code) !== keccak256(artifactRuntimeBytecode(item))) {
          throw new Error(`${key} 기존 배포코드가 현재 산출물과 다르다.`);
        }
      }
      progress.resumedFromCommits = [...(progress.resumedFromCommits ?? []), progress.gitCommit];
      progress.gitCommit = gitCommit;
      progress.policyVersion = evidence(`POLICY_V1:${gitCommit}`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    progress = {
      schemaVersion: "1.0.0",
      simulation: true,
      chainId: FUJI_CHAIN_ID,
      gitCommit,
      officialIsinEvidenceSha256: official.evidenceSha256,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: "IN_PROGRESS",
      deployer: deployer.address,
      safeOwners: [accounts.safeOwner1.address, accounts.safeOwner2.address, accounts.safeOwner3.address],
      contracts: {},
      tokens: {},
      transactions: {},
      policyVersion: evidence(`POLICY_V1:${gitCommit}`),
    };
  }
  const save = async () => {
    progress.updatedAt = new Date().toISOString();
    await mkdir(resolve(progressPath, ".."), { recursive: true });
    await writeFile(progressPath, `${JSON.stringify(progress, null, 2)}\n`, "utf8");
  };
  await save();

  const wallets = Object.fromEntries(
    Object.entries(accounts).map(([alias, account]) => [
      alias,
      createWalletClient({ account, chain: fujiChain, transport }),
    ]),
  ) as unknown as Record<RoleAlias, ReturnType<typeof createWalletClient>>;

  const waitRecorded = async (label: string): Promise<Hex | undefined> => {
    const existing = progress.transactions[label];
    if (!existing) return undefined;
    const receipt = await publicClient.waitForTransactionReceipt({ hash: existing, timeout: 180_000 });
    if (receipt.status !== "success") throw new Error(`${label} 기존 Fuji 거래가 실패했다: ${existing}`);
    return existing;
  };
  const write = async (
    label: string,
    address: Address,
    abi: Abi,
    functionName: string,
    args: readonly unknown[],
    alias: RoleAlias = "deployer",
  ) => {
    const existing = await waitRecorded(label);
    if (existing) return existing;
    const wallet = wallets[alias];
    const data = encodeFunctionData({ abi, functionName, args } as never);
    const gas = await estimateFujiGas(rpcUrl, {
      from: accounts[alias].address,
      to: address,
      data,
    });
    const hash = await wallet.writeContract({
      address,
      abi,
      functionName,
      args,
      gas,
      account: accounts[alias],
      chain: fujiChain,
    } as never);
    progress.transactions[label] = hash;
    await save();
    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 180_000 });
    if (receipt.status !== "success") throw new Error(`${label} Fuji 거래가 실패했다: ${hash}`);
    return hash;
  };
  const deploy = async (
    key: ContractName,
    name: string,
    args: readonly unknown[] = [],
    externalPath?: string,
  ) => {
    const known = progress.contracts[key];
    const item = await artifact(name, externalPath);
    if (known) {
      const existingCode = await publicClient.getCode({ address: known });
      if (!existingCode || existingCode === "0x") {
        throw new Error(`${key} 진행기록 주소에 배포코드가 없다.`);
      }
      return { address: known, abi: item.abi };
    }
    const data = encodeDeployData({ abi: item.abi, bytecode: artifactBytecode(item), args });
    const gas = await estimateFujiGas(rpcUrl, { from: deployer.address, data });
    const hash = await deployerWallet.deployContract({
      abi: item.abi,
      bytecode: artifactBytecode(item),
      args,
      gas,
    });
    progress.transactions[`deploy:${key}`] = hash;
    await save();
    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 180_000 });
    if (receipt.status !== "success" || !receipt.contractAddress) {
      throw new Error(`${key} Fuji 배포에 실패했다.`);
    }
    progress.contracts[key] = receipt.contractAddress;
    await save();
    return { address: receipt.contractAddress, abi: item.abi };
  };

  const safeSingleton = await deploy(
    "safeSingleton",
    "SafeL2",
    [],
    "node_modules/@safe-global/safe-contracts/build/artifacts/contracts/SafeL2.sol/SafeL2.json",
  );
  const safeFactory = await deploy(
    "safeProxyFactory",
    "SafeProxyFactory",
    [],
    "node_modules/@safe-global/safe-contracts/build/artifacts/contracts/proxies/SafeProxyFactory.sol/SafeProxyFactory.json",
  );
  const safeSetupAbi = parseAbi([
    "function setup(address[] owners,uint256 threshold,address to,bytes data,address fallbackHandler,address paymentToken,uint256 payment,address paymentReceiver)",
  ]);
  const safeFactoryAbi = parseAbi([
    "function createProxyWithNonce(address singleton,bytes initializer,uint256 saltNonce) returns (address proxy)",
    "event ProxyCreation(address indexed proxy,address singleton)",
  ]);
  if (!progress.safe) {
    const initializer = encodeFunctionData({
      abi: safeSetupAbi,
      functionName: "setup",
      args: [progress.safeOwners, 2n, zeroAddress, "0x", zeroAddress, zeroAddress, 0n, zeroAddress],
    });
    const label = "create:safe-proxy";
    const safeArgs = [
      safeSingleton.address,
      initializer,
      BigInt(`0x${gitCommit.slice(0, 12)}`),
    ] as const;
    const gas = await estimateFujiGas(rpcUrl, {
      from: deployer.address,
      to: safeFactory.address,
      data: encodeFunctionData({
        abi: safeFactoryAbi,
        functionName: "createProxyWithNonce",
        args: safeArgs,
      }),
    });
    const hash = await deployerWallet.writeContract({
      address: safeFactory.address,
      abi: safeFactoryAbi,
      functionName: "createProxyWithNonce",
      args: safeArgs,
      gas,
      account: deployer,
      chain: fujiChain,
    });
    progress.transactions[label] = hash;
    await save();
    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 180_000 });
    const event = receipt.logs
      .map((log) => {
        try {
          return decodeEventLog({ abi: safeFactoryAbi, data: log.data, topics: log.topics });
        } catch {
          return undefined;
        }
      })
      .find((entry) => entry?.eventName === "ProxyCreation");
    const safe = (event?.args as { proxy?: Address } | undefined)?.proxy;
    if (!safe) throw new Error("Safe 프록시 주소를 확인할 수 없다.");
    progress.safe = safe;
    await save();
  }

  const timelock = await deploy("timelock", "TimelockController", [
    60n,
    [progress.safe],
    [progress.safe],
    zeroAddress,
  ]);
  const eligibility = await deploy("eligibilityRegistry", "EligibilityRegistry", [deployer.address]);
  const policy = await deploy("marketPolicyRegistry", "MarketPolicyRegistry", [
    deployer.address,
    progress.policyVersion,
  ]);
  const verifier = await deploy("intentVerifier", "IntentVerifier", [deployer.address, policy.address]);
  const factory = await deploy("securityTokenFactory", "SecurityTokenFactory", [
    deployer.address,
    eligibility.address,
    policy.address,
  ]);
  const issuance = await deploy("issuanceController", "IssuanceController", [
    deployer.address,
    verifier.address,
    factory.address,
  ]);
  const secondary = await deploy("secondarySettlementController", "SecondarySettlementController", [
    deployer.address,
    verifier.address,
    eligibility.address,
    policy.address,
  ]);
  const redemption = await deploy("redemptionController", "RedemptionController", [
    deployer.address,
    verifier.address,
  ]);
  const recovery = await deploy("recoveryController", "RecoveryController", [deployer.address]);
  const corporateAction = await deploy("corporateActionController", "CorporateActionController", [
    deployer.address,
  ]);
  const mockUsdc = await deploy("mockUsdc", "MockUsdc");
  const accessAbi = parseAbi([
    "function grantRole(bytes32 role,address account)",
    "function revokeRole(bytes32 role,address account)",
    "function renounceRole(bytes32 role,address callerConfirmation)",
  ]);

  for (const alias of roleAliases.filter(
    (item) => !["deployer", "safeOwner1", "safeOwner2", "safeOwner3", "brokerSigner"].includes(item),
  )) {
    const label = `fund:${alias}`;
    if (!(await waitRecorded(label))) {
      const hash = await deployerWallet.sendTransaction({
        to: accounts[alias].address,
        value: parseEther("0.01"),
        gas: 21_000n,
      });
      progress.transactions[label] = hash;
      await save();
      const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 180_000 });
      if (receipt.status !== "success") throw new Error(`${alias} 시험 가스 지급에 실패했다.`);
    }
  }

  await write("role:eligibility-operator", eligibility.address, accessAbi, "grantRole", [
    role("ELIGIBILITY_OPERATOR_ROLE"),
    accounts.eligibilityOperator.address,
  ]);
  const validUntil = 2_000_000_000n;
  for (const alias of ["investor", "marketMaker"] as const) {
    await write(
      `eligibility:${alias}`,
      eligibility.address,
      eligibility.abi,
      "setEligibility",
      [workflow(`ELIGIBILITY_${alias}`), accounts[alias].address, true, validUntil, evidence(`ELIGIBILITY_${alias}`)],
      "eligibilityOperator",
    );
  }
  await write(
    "eligibility:market-maker",
    eligibility.address,
    eligibility.abi,
    "setMarketMaker",
    [workflow("MARKET_MAKER"), accounts.marketMaker.address, true, validUntil, evidence("MARKET_MAKER")],
    "eligibilityOperator",
  );
  await write("verifier:broker-signer", verifier.address, verifier.abi, "setBrokerSettlementSigner", [
    workflow("BROKER_SIGNER"),
    accounts.brokerSigner.address,
    evidence("BROKER_SIGNER"),
  ]);

  const designVersion = evidence(`CONTRACT_DESIGN_V1:${gitCommit}`);
  for (const security of official.securities) {
    const key = security.shortCode;
    if (!progress.tokens[key]) {
      await write(`token:deploy:${key}`, factory.address, factory.abi, "deploySecurityToken", [
        workflow(`DEPLOY_${key}`),
        key,
        security.isin,
        `모의 ${security.itemName} 수탁권리 (Fuji)`,
        `SIM${key}`,
        designVersion,
        evidence(`DEPLOY_${key}`),
      ]);
      progress.tokens[key] = (await publicClient.readContract({
        address: factory.address,
        abi: factory.abi,
        functionName: "getSecurityToken",
        args: [key, security.isin, designVersion],
      })) as Address;
      await save();
    }
  }

  const roleAssignments: Array<[string, Address, string, Address]> = [
    ["issuance:execution", issuance.address, "EXECUTION_ALLOCATION_CONFIRMER_ROLE", accounts.executionConfirmer.address],
    ["issuance:risk", issuance.address, "RISK_APPROVER_ROLE", accounts.riskApprover.address],
    ["issuance:rights-approve", issuance.address, "RIGHTS_ENTRY_APPROVER_ROLE", accounts.rightsEntryApprover.address],
    ["issuance:rights-record", issuance.address, "RIGHTS_RECORDING_CONFIRMER_ROLE", accounts.rightsRecordingConfirmer.address],
    ["issuance:settlement", issuance.address, "SETTLEMENT_CONFIRMER_ROLE", accounts.settlementConfirmer.address],
    ["issuance:custody", issuance.address, "CUSTODY_CONFIRMER_ROLE", accounts.custodyConfirmer.address],
    ["issuance:execute", issuance.address, "ISSUANCE_EXECUTOR_ROLE", accounts.issuanceExecutor.address],
    ["secondary:execute", secondary.address, "SETTLEMENT_EXECUTOR_ROLE", accounts.secondaryExecutor.address],
    ["redemption:rights", redemption.address, "REDEMPTION_RIGHTS_APPROVER_ROLE", accounts.redemptionRightsApprover.address],
    ["redemption:settlement", redemption.address, "SETTLEMENT_CONFIRMER_ROLE", accounts.settlementConfirmer.address],
    ["redemption:payment", redemption.address, "PAYMENT_APPROVER_ROLE", accounts.paymentApprover.address],
    ["redemption:execute", redemption.address, "REDEMPTION_EXECUTOR_ROLE", accounts.redemptionExecutor.address],
  ];
  for (const [label, address, roleName, member] of roleAssignments) {
    await write(`role:${label}`, address, accessAbi, "grantRole", [role(roleName), member]);
  }
  await write("role:verifier-issuance", verifier.address, accessAbi, "grantRole", [
    role("ISSUANCE_EXECUTOR_ROLE"),
    issuance.address,
  ]);
  await write("role:verifier-secondary", verifier.address, accessAbi, "grantRole", [
    role("SETTLEMENT_EXECUTOR_ROLE"),
    secondary.address,
  ]);
  await write("role:verifier-redemption", verifier.address, accessAbi, "grantRole", [
    role("REDEMPTION_EXECUTOR_ROLE"),
    redemption.address,
  ]);
  for (const [securityId, token] of Object.entries(progress.tokens)) {
    for (const [label, roleName, controller] of [
      ["issuance", "ISSUANCE_EXECUTOR_ROLE", issuance.address],
      ["secondary", "SETTLEMENT_EXECUTOR_ROLE", secondary.address],
      ["redemption", "REDEMPTION_EXECUTOR_ROLE", redemption.address],
      ["recovery", "RECOVERY_EXECUTOR_ROLE", recovery.address],
      ["corporate-action", "CORPORATE_ACTION_EXECUTOR_ROLE", corporateAction.address],
    ] as const) {
      await write(`role:token:${securityId}:${label}`, token, accessAbi, "grantRole", [role(roleName), controller]);
    }
  }

  const governed = [eligibility, policy, verifier, factory, issuance, secondary, redemption, recovery, corporateAction];
  for (const contract of governed) {
    await write(`admin:grant:${contract.address}`, contract.address, accessAbi, "grantRole", [defaultAdmin, timelock.address]);
    await write(`admin:renounce:${contract.address}`, contract.address, accessAbi, "renounceRole", [defaultAdmin, deployer.address]);
  }
  for (const token of Object.values(progress.tokens)) {
    await write(`admin:grant:${token}`, token, accessAbi, "grantRole", [defaultAdmin, timelock.address]);
    await write(`admin:renounce:${token}`, token, accessAbi, "renounceRole", [defaultAdmin, deployer.address]);
  }

  progress.status = "COMPLETE";
  await save();
  const manifest = {
    ...progress,
    completedAt: new Date().toISOString(),
    rpcUrl: rpcUrl === OFFICIAL_FUJI_RPC ? OFFICIAL_FUJI_RPC : "custom-fuji-rpc",
    governance: { safe: progress.safe, timelock: timelock.address, threshold: 2, minimumDelaySeconds: 60 },
    actors: Object.fromEntries(Object.entries(accounts).map(([alias, account]) => [alias, account.address])),
    designVersion,
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(`Fuji 배포를 완료했다: ${manifestPath}`);
  console.log(`Safe: ${progress.safe}`);
  for (const [securityId, token] of Object.entries(progress.tokens)) console.log(`${securityId}: ${token}`);
}

await main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Fuji 배포를 완료하지 못했다: ${message}`);
  process.exitCode = 1;
});
