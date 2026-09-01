import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  toHex,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";

import { anvilChain, writeRedemptionController } from "../src/index.js";

const root = resolve(import.meta.dirname, "../../..");
const administrator = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex,
);
const marketMaker = privateKeyToAccount(keccak256(toHex("hedge-redemption-market-maker")));

type Artifact = { abi: Abi; bytecode: { object: Hex } };
async function artifact(name: string): Promise<Artifact> {
  return JSON.parse(
    await readFile(resolve(root, `contracts/out/${name}.sol/${name}.json`), "utf8"),
  ) as Artifact;
}

const redemptionType = {
  RedemptionIntent: [
    { name: "redemptionId", type: "bytes16" },
    { name: "investor", type: "address" },
    { name: "token", type: "address" },
    { name: "shareQuantity", type: "uint256" },
    { name: "krwLimitPrice", type: "uint256" },
    { name: "targetTradingDate", type: "string" },
    { name: "nonce", type: "uint256" },
    { name: "expiresAt", type: "uint256" },
    { name: "policyVersion", type: "bytes32" },
  ],
} as const;

describe("Anvil 시장조성자 매도 헤지", () => {
  it("권리 잠금, 지급청구, USD 지급 승인과 소각을 순서대로 완결한다", async () => {
    const rpc = process.env.ANVIL_RPC_URL ?? "http://127.0.0.1:8545";
    const transport = http(rpc);
    const publicClient = createPublicClient({ chain: anvilChain, transport });
    const wallet = createWalletClient({ account: administrator, chain: anvilChain, transport });
    const deploy = async (name: string, args: readonly unknown[]) => {
      const item = await artifact(name);
      const hash = await wallet.deployContract({
        abi: item.abi,
        bytecode: item.bytecode.object,
        args,
      });
      return (await publicClient.waitForTransactionReceipt({ hash })).contractAddress as Address;
    };
    const write = async (
      address: Address,
      abi: Abi,
      functionName: string,
      args: readonly unknown[],
    ) => {
      const hash = await wallet.writeContract({
        address,
        abi,
        functionName,
        args,
        account: wallet.account,
        chain: anvilChain,
      } as never);
      await publicClient.waitForTransactionReceipt({ hash });
    };
    const role = (name: string) => keccak256(toHex(name));
    const workflow = (number: number) => `0x${number.toString(16).padStart(32, "0")}` as Hex;
    const evidence = (label: string) => keccak256(toHex(label));
    const policyVersion = keccak256(toHex("LOCAL-POLICY-V1"));
    const eligibility = await deploy("EligibilityRegistry", [administrator.address]);
    const policy = await deploy("MarketPolicyRegistry", [administrator.address, policyVersion]);
    const verifier = await deploy("IntentVerifier", [administrator.address, policy]);
    const token = await deploy("RestrictedEquityToken", [
      "Synthetic Hynix Rights",
      "SIM990002",
      administrator.address,
      eligibility,
      policy,
    ]);
    const controller = await deploy("RedemptionController", [administrator.address, verifier]);
    const eligibilityAbi = (await artifact("EligibilityRegistry")).abi;
    const verifierAbi = (await artifact("IntentVerifier")).abi;
    const tokenAbi = (await artifact("RestrictedEquityToken")).abi;
    const controllerAbi = (await artifact("RedemptionController")).abi;
    const block = await publicClient.getBlock();
    const expiresAt = block.timestamp + 3_600n;

    await write(eligibility, eligibilityAbi, "grantRole", [
      role("ELIGIBILITY_OPERATOR_ROLE"),
      administrator.address,
    ]);
    await write(eligibility, eligibilityAbi, "setEligibility", [
      workflow(1),
      marketMaker.address,
      true,
      expiresAt,
      evidence("eligible"),
    ]);
    await write(token, tokenAbi, "grantRole", [
      role("ISSUANCE_EXECUTOR_ROLE"),
      administrator.address,
    ]);
    await write(token, tokenAbi, "grantRole", [role("REDEMPTION_EXECUTOR_ROLE"), controller]);
    await write(verifier, verifierAbi, "grantRole", [role("REDEMPTION_EXECUTOR_ROLE"), controller]);
    for (const roleName of [
      "REDEMPTION_EXECUTOR_ROLE",
      "REDEMPTION_RIGHTS_APPROVER_ROLE",
      "SETTLEMENT_CONFIRMER_ROLE",
      "PAYMENT_APPROVER_ROLE",
    ])
      await write(controller, controllerAbi, "grantRole", [role(roleName), administrator.address]);
    await write(token, tokenAbi, "mintPending", [
      workflow(2),
      marketMaker.address,
      104n,
      evidence("mint"),
    ]);
    await write(token, tokenAbi, "releasePending", [
      workflow(3),
      marketMaker.address,
      104n,
      evidence("release"),
    ]);

    const redemptionId = workflow(20);
    const intent = {
      redemptionId,
      investor: marketMaker.address,
      token,
      shareQuantity: 4n,
      krwLimitPrice: 1_653_000n,
      targetTradingDate: "2026-09-01",
      nonce: 501n,
      expiresAt,
      policyVersion,
    };
    const signature = await marketMaker.signTypedData({
      domain: {
        name: "Korean Equity RWA Intent",
        version: "1",
        chainId: 31_337,
        verifyingContract: verifier,
      },
      types: redemptionType,
      primaryType: "RedemptionIntent",
      message: intent,
    });
    const execute = async (
      functionName: Parameters<typeof writeRedemptionController>[1]["functionName"],
      args: readonly unknown[],
    ) => {
      const hash = await writeRedemptionController(wallet, { controller, functionName, args });
      await publicClient.waitForTransactionReceipt({ hash });
    };
    await execute("lockRedemption", [redemptionId, intent, signature]);
    await execute("markDomesticSaleSubmitted", [redemptionId, evidence("sale-submitted")]);
    await execute("confirmDomesticExecution", [redemptionId, 4n, evidence("execution")]);
    await execute("confirmSaleProceedsSettled", [
      redemptionId,
      4n,
      478_840n,
      evidence("sale-proceeds"),
    ]);
    await execute("confirmRightsTerminated", [
      redemptionId,
      token,
      marketMaker.address,
      4n,
      evidence("rights-terminated"),
    ]);
    await execute("confirmCashClaim", [redemptionId, 4n, 478_840n, evidence("cash-claim")]);
    await execute("markBurnPending", [redemptionId]);
    await execute("approveUsdPayment", [redemptionId, 478_840n, evidence("usd-paid")]);
    await execute("executeBurn", [redemptionId]);

    expect(
      await publicClient.readContract({
        address: token,
        abi: tokenAbi,
        functionName: "totalSupply",
      }),
    ).toBe(100n);
    expect(
      await publicClient.readContract({
        address: token,
        abi: tokenAbi,
        functionName: "burnPendingBalanceOf",
        args: [marketMaker.address],
      }),
    ).toBe(0n);
  });
});
