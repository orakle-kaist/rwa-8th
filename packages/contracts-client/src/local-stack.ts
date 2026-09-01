import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  defineChain,
  http,
  keccak256,
  padHex,
  parseAbi,
  parseEther,
  stringToHex,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const anvilChain = defineChain({
  id: 31_337,
  name: "RWA PoC Anvil",
  nativeCurrency: { name: "Anvil Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } },
});

const DEFAULT_ANVIL_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex;

type Artifact = { abi: Abi; bytecode: Hex | { object: Hex } };

export interface LocalDeploymentManifest {
  schemaVersion: "1.0.0";
  simulation: true;
  chainId: 31337;
  rpcUrl: string;
  deployedAt: string;
  deployer: Address;
  governance: { safe: Address; timelock: Address; threshold: 2; minimumDelaySeconds: 60 };
  contracts: {
    eligibilityRegistry: Address;
    marketPolicyRegistry: Address;
    intentVerifier: Address;
    securityTokenFactory: Address;
    issuanceController: Address;
    secondarySettlementController: Address;
    redemptionController: Address;
    recoveryController: Address;
    corporateActionController: Address;
    mockUsdc: Address;
  };
  tokens: Record<"990001" | "990002" | "990003", Address>;
  wallets: { investorA: Address; investorB: Address; marketMaker: Address; brokerSigner: Address };
  policyVersion: Hex;
}

const root = resolve(import.meta.dirname, "../../..");
const accessAbi = parseAbi([
  "function grantRole(bytes32 role,address account)",
  "function revokeRole(bytes32 role,address account)",
  "function renounceRole(bytes32 role,address callerConfirmation)",
  "function DEFAULT_ADMIN_ROLE() view returns (bytes32)",
]);

function role(name: string): Hex {
  return keccak256(stringToHex(name));
}

function evidence(label: string): Hex {
  return keccak256(stringToHex(`LOCAL_DEMO:${label}`));
}

function workflow(label: string): Hex {
  return keccak256(stringToHex(`LOCAL_WORKFLOW:${label}`)).slice(0, 34) as Hex;
}

async function waitForAnvil(rpcUrl: string): Promise<void> {
  let lastError: unknown;
  let connectionRefused = false;
  for (let attempt = 1; attempt <= 60; attempt += 1) {
    try {
      const response = await fetch(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
        signal: AbortSignal.timeout(1_000),
      });
      const payload = (await response.json()) as { result?: string };
      if (response.ok && payload.result === "0x7a69") return;
      lastError = new Error(`예상하지 않은 Anvil chain ID: ${payload.result ?? "응답 없음"}`);
    } catch (error) {
      lastError = error;
      connectionRefused ||=
        error instanceof TypeError &&
        error.cause instanceof Error &&
        "code" in error.cause &&
        error.cause.code === "ECONNREFUSED";
    }
    await delay(250);
  }
  const message = connectionRefused
    ? "Anvil 컨테이너는 실행됐지만 Docker 네트워크에서 RPC에 연결할 수 없다. Anvil이 0.0.0.0:8545에 바인딩됐는지 확인한다."
    : "Anvil RPC가 15초 안에 올바른 chain ID 31337로 응답하지 않았다.";
  throw new Error(message, { cause: lastError });
}

async function artifact(name: string, externalPath?: string): Promise<Artifact> {
  const path = externalPath ?? `contracts/out/${name}.sol/${name}.json`;
  return JSON.parse(await readFile(resolve(root, path), "utf8")) as Artifact;
}

function bytecode(item: Artifact): Hex {
  return typeof item.bytecode === "string" ? item.bytecode : item.bytecode.object;
}

export async function deployLocalStack(input?: {
  rpcUrl?: string;
  deployerPrivateKey?: Hex;
  outputPath?: string;
}): Promise<LocalDeploymentManifest> {
  const rpcUrl = input?.rpcUrl ?? "http://127.0.0.1:8545";
  await waitForAnvil(rpcUrl);
  const deployer = privateKeyToAccount(input?.deployerPrivateKey ?? DEFAULT_ANVIL_KEY);
  const transport = http(rpcUrl);
  const publicClient = createPublicClient({ chain: anvilChain, transport });
  const wallet = createWalletClient({ account: deployer, chain: anvilChain, transport });
  if ((await publicClient.getChainId()) !== 31337) throw new Error("로컬 배포는 Anvil 31337에서만 허용한다.");

  const deploy = async (name: string, args: readonly unknown[] = [], externalPath?: string) => {
    const item = await artifact(name, externalPath);
    const hash = await wallet.deployContract({ abi: item.abi, bytecode: bytecode(item), args });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success" || !receipt.contractAddress)
      throw new Error(`${name} 로컬 배포에 실패했다.`);
    return { address: receipt.contractAddress, abi: item.abi };
  };
  const write = async (address: Address, abi: Abi, functionName: string, args: readonly unknown[]) => {
    const hash = await wallet.writeContract({
      address,
      abi,
      functionName,
      args,
      account: deployer,
      chain: anvilChain,
    } as never);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`${functionName} 로컬 실행에 실패했다.`);
    return hash;
  };

  const accountResponse = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_accounts", params: [] }),
  });
  const accountPayload = (await accountResponse.json()) as { result?: Address[] };
  const anvilOwners = accountPayload.result ?? [];
  if (anvilOwners.length < 3) throw new Error("Safe 소유자용 Anvil 계정 세 개가 필요하다.");
  const safeSingleton = await deploy(
    "SafeL2",
    [],
    "node_modules/@safe-global/safe-contracts/build/artifacts/contracts/SafeL2.sol/SafeL2.json",
  );
  const safeFactory = await deploy(
    "SafeProxyFactory",
    [],
    "node_modules/@safe-global/safe-contracts/build/artifacts/contracts/proxies/SafeProxyFactory.sol/SafeProxyFactory.json",
  );
  const safeSetupAbi = parseAbi([
    "function setup(address[] owners,uint256 threshold,address to,bytes data,address fallbackHandler,address paymentToken,uint256 payment,address paymentReceiver)",
  ]);
  const setupData = (await import("viem")).encodeFunctionData({
    abi: safeSetupAbi,
    functionName: "setup",
    args: [anvilOwners.slice(0, 3), 2n, "0x0000000000000000000000000000000000000000", "0x", "0x0000000000000000000000000000000000000000", "0x0000000000000000000000000000000000000000", 0n, "0x0000000000000000000000000000000000000000"],
  });
  const safeFactoryAbi = parseAbi([
    "function createProxyWithNonce(address singleton,bytes initializer,uint256 saltNonce) returns (address proxy)",
    "event ProxyCreation(address indexed proxy,address singleton)",
  ]);
  const safeHash = await wallet.writeContract({
    address: safeFactory.address,
    abi: safeFactoryAbi,
    functionName: "createProxyWithNonce",
    args: [safeSingleton.address, setupData, 1n],
    account: deployer,
    chain: anvilChain,
  });
  const safeReceipt = await publicClient.waitForTransactionReceipt({ hash: safeHash });
  const safeLog = safeReceipt.logs
    .map((log) => {
      try {
        return decodeEventLog({ abi: safeFactoryAbi, data: log.data, topics: log.topics });
      } catch {
        return undefined;
      }
    })
    .find((event) => event?.eventName === "ProxyCreation");
  const safe = (safeLog?.args as { proxy?: Address } | undefined)?.proxy;
  if (!safe) throw new Error("Safe 프록시 주소를 확인할 수 없다.");

  const timelock = await deploy("TimelockController", [60n, [safe], [safe], "0x0000000000000000000000000000000000000000"]);
  const policyVersion = keccak256(stringToHex("LOCAL-POLICY-V1"));
  const eligibility = await deploy("EligibilityRegistry", [deployer.address]);
  const policy = await deploy("MarketPolicyRegistry", [deployer.address, policyVersion]);
  const verifier = await deploy("IntentVerifier", [deployer.address, policy.address]);
  const factory = await deploy("SecurityTokenFactory", [deployer.address, eligibility.address, policy.address]);
  const issuance = await deploy("IssuanceController", [deployer.address, verifier.address, factory.address]);
  const secondary = await deploy("SecondarySettlementController", [deployer.address, verifier.address, eligibility.address, policy.address]);
  const redemption = await deploy("RedemptionController", [deployer.address, verifier.address]);
  const recovery = await deploy("RecoveryController", [deployer.address]);
  const corporateAction = await deploy("CorporateActionController", [deployer.address]);
  const mockUsdc = await deploy("MockUsdc");

  const investorA = privateKeyToAccount(keccak256(stringToHex("PRIMARY-DEMO-A")));
  const investorB = privateKeyToAccount(keccak256(stringToHex("PRIMARY-DEMO-B")));
  const marketMaker = privateKeyToAccount(keccak256(stringToHex("SECONDARY-DEMO-MM")));
  const broker = privateKeyToAccount(keccak256(stringToHex("SECONDARY-BROKER")));

  await write(eligibility.address, eligibility.abi, "grantRole", [role("ELIGIBILITY_OPERATOR_ROLE"), deployer.address]);
  const validUntil = BigInt(Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60);
  for (const [index, account] of [investorA, investorB, marketMaker].entries())
    await write(eligibility.address, eligibility.abi, "setEligibility", [workflow(`ELIGIBLE_${index}`), account.address, true, validUntil, evidence(`ELIGIBLE_${index}`)]);
  await write(eligibility.address, eligibility.abi, "setMarketMaker", [workflow("MARKET_MAKER"), marketMaker.address, true, validUntil, evidence("MARKET_MAKER")]);
  await write(verifier.address, verifier.abi, "setBrokerSettlementSigner", [workflow("BROKER_SIGNER"), broker.address, evidence("BROKER_SIGNER")]);
  await write(policy.address, policy.abi, "grantRole", [role("EMERGENCY_PAUSER_ROLE"), deployer.address]);

  const products = [
    ["990001", "TEST00000001", "모의 삼성전자 1차 발행 시나리오", "SIM990001"],
    ["990002", "TEST00000002", "모의 SK하이닉스 24/7 시나리오", "SIM990002"],
    ["990003", "TEST00000003", "모의 미래에셋증권 기업행동 시나리오", "SIM990003"],
  ] as const;
  const designVersion = evidence("CONTRACT_DESIGN_V1");
  const tokens = {} as LocalDeploymentManifest["tokens"];
  for (const [securityId, syntheticKey, displayName, symbol] of products) {
    await write(factory.address, factory.abi, "deploySecurityToken", [workflow(`DEPLOY_${securityId}`), securityId, syntheticKey, displayName, symbol, designVersion, evidence(`DEPLOY_${securityId}`)]);
    tokens[securityId] = (await publicClient.readContract({ address: factory.address, abi: factory.abi, functionName: "getSecurityToken", args: [securityId, syntheticKey, designVersion] })) as Address;
  }

  const controllerRoles: Array<[Address, Abi, string[]]> = [
    [issuance.address, issuance.abi, ["EXECUTION_ALLOCATION_CONFIRMER_ROLE", "RISK_APPROVER_ROLE", "RIGHTS_ENTRY_APPROVER_ROLE", "RIGHTS_RECORDING_CONFIRMER_ROLE", "SETTLEMENT_CONFIRMER_ROLE", "CUSTODY_CONFIRMER_ROLE", "ISSUANCE_EXECUTOR_ROLE"]],
    [secondary.address, secondary.abi, ["SETTLEMENT_EXECUTOR_ROLE"]],
    [redemption.address, redemption.abi, ["REDEMPTION_RIGHTS_APPROVER_ROLE", "SETTLEMENT_CONFIRMER_ROLE", "PAYMENT_APPROVER_ROLE", "REDEMPTION_EXECUTOR_ROLE"]],
    [recovery.address, recovery.abi, ["RECOVERY_RIGHTS_APPROVER_ROLE", "RECOVERY_COMPLIANCE_APPROVER_ROLE", "RECOVERY_EXECUTOR_ROLE"]],
    [corporateAction.address, corporateAction.abi, ["CORPORATE_ACTION_RIGHTS_APPROVER_ROLE", "CORPORATE_ACTION_AUDIT_APPROVER_ROLE", "CORPORATE_ACTION_EXECUTOR_ROLE"]],
  ];
  for (const [address, abi, names] of controllerRoles)
    for (const name of names) await write(address, abi, "grantRole", [role(name), deployer.address]);
  await write(verifier.address, verifier.abi, "grantRole", [role("ISSUANCE_EXECUTOR_ROLE"), issuance.address]);
  await write(verifier.address, verifier.abi, "grantRole", [role("SETTLEMENT_EXECUTOR_ROLE"), secondary.address]);
  await write(verifier.address, verifier.abi, "grantRole", [role("REDEMPTION_EXECUTOR_ROLE"), redemption.address]);

  const tokenArtifact = await artifact("RestrictedEquityToken");
  for (const token of Object.values(tokens)) {
    await write(token, tokenArtifact.abi, "grantRole", [role("ISSUANCE_EXECUTOR_ROLE"), issuance.address]);
    await write(token, tokenArtifact.abi, "grantRole", [role("SETTLEMENT_EXECUTOR_ROLE"), secondary.address]);
    await write(token, tokenArtifact.abi, "grantRole", [role("REDEMPTION_EXECUTOR_ROLE"), redemption.address]);
    await write(token, tokenArtifact.abi, "grantRole", [role("RECOVERY_EXECUTOR_ROLE"), recovery.address]);
    await write(token, tokenArtifact.abi, "grantRole", [role("CORPORATE_ACTION_EXECUTOR_ROLE"), corporateAction.address]);
    for (const name of ["ISSUANCE_EXECUTOR_ROLE", "REDEMPTION_EXECUTOR_ROLE", "RECOVERY_EXECUTOR_ROLE"])
      await write(token, tokenArtifact.abi, "grantRole", [role(name), deployer.address]);
  }

  await write(tokens["990002"], tokenArtifact.abi, "mintPending", [workflow("MM_SEED_MINT"), marketMaker.address, 120n, evidence("MM_SEED_MINT")]);
  await write(tokens["990002"], tokenArtifact.abi, "releasePending", [workflow("MM_SEED_RELEASE"), marketMaker.address, 100n, evidence("MM_SEED_RELEASE")]);
  await write(tokens["990003"], tokenArtifact.abi, "mintPending", [workflow("CA_SEED_MINT"), investorA.address, 10n, evidence("CA_SEED_MINT")]);
  await write(tokens["990003"], tokenArtifact.abi, "releasePending", [workflow("CA_SEED_RELEASE"), investorA.address, 8n, evidence("CA_SEED_RELEASE")]);
  await write(tokens["990003"], tokenArtifact.abi, "lockForRedemption", [workflow("CA_SEED_LOCK"), investorA.address, 3n, evidence("CA_SEED_LOCK")]);
  await write(tokens["990003"], tokenArtifact.abi, "markBurnPending", [workflow("CA_SEED_BURN_PENDING"), investorA.address, 1n, evidence("CA_SEED_BURN_PENDING")]);
  await write(tokens["990003"], tokenArtifact.abi, "freezeAvailable", [workflow("CA_SEED_FREEZE"), investorA.address, 1n, evidence("CA_SEED_FREEZE")]);

  const usdcAbi = mockUsdc.abi;
  for (const account of [investorB, marketMaker]) {
    const fundHash = await wallet.sendTransaction({ to: account.address, value: parseEther("10") });
    await publicClient.waitForTransactionReceipt({ hash: fundHash });
    await write(mockUsdc.address, usdcAbi, "mint", [account.address, 250_000n * 1_000_000n]);
    const accountWallet = createWalletClient({ account, chain: anvilChain, transport });
    const approveHash = await accountWallet.writeContract({ address: mockUsdc.address, abi: usdcAbi, functionName: "approve", args: [secondary.address, 250_000n * 1_000_000n], account, chain: anvilChain } as never);
    await publicClient.waitForTransactionReceipt({ hash: approveHash });
  }

  for (const token of Object.values(tokens))
    for (const name of ["ISSUANCE_EXECUTOR_ROLE", "REDEMPTION_EXECUTOR_ROLE"])
      await write(token, tokenArtifact.abi, "revokeRole", [role(name), deployer.address]);

  const governed = [eligibility, policy, verifier, factory, issuance, secondary, redemption, recovery, corporateAction];
  const defaultAdmin = `0x${"00".repeat(32)}` as Hex;
  for (const contract of governed) {
    await write(contract.address, contract.abi, "grantRole", [defaultAdmin, timelock.address]);
    await write(contract.address, contract.abi, "renounceRole", [defaultAdmin, deployer.address]);
  }
  for (const token of Object.values(tokens)) {
    await write(token, tokenArtifact.abi, "grantRole", [defaultAdmin, timelock.address]);
    await write(token, tokenArtifact.abi, "renounceRole", [defaultAdmin, deployer.address]);
  }

  const manifest: LocalDeploymentManifest = {
    schemaVersion: "1.0.0",
    simulation: true,
    chainId: 31337,
    rpcUrl,
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
    governance: { safe, timelock: timelock.address, threshold: 2, minimumDelaySeconds: 60 },
    contracts: {
      eligibilityRegistry: eligibility.address,
      marketPolicyRegistry: policy.address,
      intentVerifier: verifier.address,
      securityTokenFactory: factory.address,
      issuanceController: issuance.address,
      secondarySettlementController: secondary.address,
      redemptionController: redemption.address,
      recoveryController: recovery.address,
      corporateActionController: corporateAction.address,
      mockUsdc: mockUsdc.address,
    },
    tokens,
    wallets: { investorA: investorA.address, investorB: investorB.address, marketMaker: marketMaker.address, brokerSigner: broker.address },
    policyVersion,
  };
  const outputPath = resolve(root, input?.outputPath ?? ".runtime/local-deployment.json");
  await mkdir(resolve(outputPath, ".."), { recursive: true });
  await writeFile(outputPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  return manifest;
}

export function paymentAssetId(address: Address): Hex {
  return padHex(address, { size: 32 });
}
