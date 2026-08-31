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

import { anvilChain } from "../src/index.js";

const root = resolve(import.meta.dirname, "../../..");
const account = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex,
);
type Artifact = { abi: Abi; bytecode: { object: Hex } };
async function artifact(name: string): Promise<Artifact> {
  return JSON.parse(
    await readFile(resolve(root, `contracts/out/${name}.sol/${name}.json`), "utf8"),
  ) as Artifact;
}

describe("Anvil 1차 발행 생애주기", () => {
  it("네 증거 뒤 결제 대기로 발행하고 결제·수탁 확인 뒤 재발행 없이 전환한다", async () => {
    const rpc = process.env.ANVIL_RPC_URL ?? "http://127.0.0.1:8545";
    const transport = http(rpc);
    const publicClient = createPublicClient({ chain: anvilChain, transport });
    const wallet = createWalletClient({ account, chain: anvilChain, transport });
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
        account,
        chain: anvilChain,
      } as never);
      await publicClient.waitForTransactionReceipt({ hash });
    };
    const policyVersion = keccak256(toHex("PRIMARY-SIM-1"));
    const eligibility = await deploy("EligibilityRegistry", [account.address]);
    const policy = await deploy("MarketPolicyRegistry", [account.address, policyVersion]);
    const verifier = await deploy("IntentVerifier", [account.address, policy]);
    const factory = await deploy("SecurityTokenFactory", [account.address, eligibility, policy]);
    const factoryArtifact = await artifact("SecurityTokenFactory");
    await write(factory, factoryArtifact.abi, "deploySecurityToken", [
      `0x${"01".repeat(16)}`,
      "990001",
      "TEST00000001",
      "Synthetic Primary Scenario",
      "SIM990001",
      keccak256(toHex("v1")),
      keccak256(toHex("deploy")),
    ]);
    const token = (await publicClient.readContract({
      address: factory,
      abi: factoryArtifact.abi,
      functionName: "getSecurityToken",
      args: ["990001", "TEST00000001", keccak256(toHex("v1"))],
    })) as Address;
    const controller = await deploy("IssuanceController", [account.address, verifier, factory]);
    const eligibilityArtifact = await artifact("EligibilityRegistry");
    const verifierArtifact = await artifact("IntentVerifier");
    const tokenArtifact = await artifact("RestrictedEquityToken");
    const controllerArtifact = await artifact("IssuanceController");
    const role = (name: string) => keccak256(toHex(name));
    await write(eligibility, eligibilityArtifact.abi, "grantRole", [
      role("ELIGIBILITY_OPERATOR_ROLE"),
      account.address,
    ]);
    await write(eligibility, eligibilityArtifact.abi, "setEligibility", [
      `0x${"02".repeat(16)}`,
      account.address,
      true,
      2_000_000_000n,
      keccak256(toHex("eligible")),
    ]);
    await write(verifier, verifierArtifact.abi, "grantRole", [
      role("ISSUANCE_EXECUTOR_ROLE"),
      controller,
    ]);
    await write(token, tokenArtifact.abi, "grantRole", [
      role("ISSUANCE_EXECUTOR_ROLE"),
      controller,
    ]);
    for (const name of [
      "EXECUTION_ALLOCATION_CONFIRMER_ROLE",
      "RISK_APPROVER_ROLE",
      "RIGHTS_ENTRY_APPROVER_ROLE",
      "RIGHTS_RECORDING_CONFIRMER_ROLE",
      "SETTLEMENT_CONFIRMER_ROLE",
      "CUSTODY_CONFIRMER_ROLE",
      "ISSUANCE_EXECUTOR_ROLE",
    ])
      await write(controller, controllerArtifact.abi, "grantRole", [role(name), account.address]);
    const workflow = `0x${"10".repeat(16)}` as Hex;
    const intent = {
      orderId: workflow,
      investor: account.address,
      securityId: "990001",
      shareQuantity: 5n,
      krwLimitPrice: 257000n,
      targetTradingDate: "2026-08-31",
      fundingMode: "USD_LEDGER",
      fundingAmountMinor: 93096n,
      nonce: 1n,
      expiresAt: 2_000_000_000n,
      policyVersion,
    };
    const signature = await account.signTypedData({
      domain: {
        name: "Korean Equity RWA Intent",
        version: "1",
        chainId: 31337,
        verifyingContract: verifier,
      },
      types: {
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
      },
      primaryType: "PrimaryOrderIntent",
      message: intent,
    });
    await write(controller, controllerArtifact.abi, "confirmExecutionAllocation", [
      workflow,
      token,
      account.address,
      6n,
      4n,
      keccak256(toHex("exec")),
      keccak256(toHex("alloc")),
    ]);
    await write(controller, controllerArtifact.abi, "approveT2Risk", [
      workflow,
      token,
      account.address,
      4n,
      keccak256(toHex("risk")),
    ]);
    await write(controller, controllerArtifact.abi, "approveRightsEntry", [
      workflow,
      token,
      account.address,
      4n,
      keccak256(toHex("approve")),
    ]);
    await write(controller, controllerArtifact.abi, "confirmRightsRecorded", [
      workflow,
      token,
      account.address,
      4n,
      keccak256(toHex("record")),
    ]);
    await write(controller, controllerArtifact.abi, "executePendingMint", [
      workflow,
      intent,
      signature,
    ]);
    expect(
      await publicClient.readContract({
        address: token,
        abi: tokenArtifact.abi,
        functionName: "pendingSettlementBalanceOf",
        args: [account.address],
      }),
    ).toBe(4n);
    await write(controller, controllerArtifact.abi, "confirmDomesticSettlement", [
      workflow,
      token,
      account.address,
      4n,
      keccak256(toHex("settlement")),
    ]);
    await write(controller, controllerArtifact.abi, "confirmCustodyQuantity", [
      workflow,
      token,
      account.address,
      4n,
      keccak256(toHex("custody")),
    ]);
    await write(controller, controllerArtifact.abi, "executeRelease", [
      workflow,
      token,
      account.address,
      4n,
    ]);
    expect(
      await publicClient.readContract({
        address: token,
        abi: tokenArtifact.abi,
        functionName: "availableBalanceOf",
        args: [account.address],
      }),
    ).toBe(4n);
    expect(
      await publicClient.readContract({
        address: token,
        abi: tokenArtifact.abi,
        functionName: "totalSupply",
      }),
    ).toBe(4n);
  });
});
