import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  createPublicClient,
  createWalletClient,
  http,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";

import { anvilChain, readRestrictedTokenFoundation } from "../src/index.js";

const repositoryRoot = resolve(import.meta.dirname, "../../..");
const anvilAccount = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex,
);

type ForgeArtifact = { abi: Abi; bytecode: { object: Hex } };

async function artifact(contractName: string): Promise<ForgeArtifact> {
  return JSON.parse(
    await readFile(
      resolve(repositoryRoot, `contracts/out/${contractName}.sol/${contractName}.json`),
      "utf8",
    ),
  ) as ForgeArtifact;
}

describe("제한형 토큰 로컬 배포", () => {
  it("Anvil에 기반 계약을 배포하고 종목 토큰 정보를 읽는다", async () => {
    const rpcUrl = process.env.ANVIL_RPC_URL ?? "http://127.0.0.1:8545";
    const transport = http(rpcUrl);
    const publicClient = createPublicClient({ chain: anvilChain, transport });
    const walletClient = createWalletClient({
      account: anvilAccount,
      chain: anvilChain,
      transport,
    });

    const eligibility = await artifact("EligibilityRegistry");
    const policy = await artifact("MarketPolicyRegistry");
    const token = await artifact("RestrictedEquityToken");

    const eligibilityHash = await walletClient.deployContract({
      abi: eligibility.abi,
      bytecode: eligibility.bytecode.object,
      args: [anvilAccount.address],
    });
    const eligibilityReceipt = await publicClient.waitForTransactionReceipt({
      hash: eligibilityHash,
    });
    const eligibilityAddress = eligibilityReceipt.contractAddress as Address;

    const policyHash = await walletClient.deployContract({
      abi: policy.abi,
      bytecode: policy.bytecode.object,
      args: [anvilAccount.address, `0x${"11".repeat(32)}`],
    });
    const policyReceipt = await publicClient.waitForTransactionReceipt({ hash: policyHash });
    const policyAddress = policyReceipt.contractAddress as Address;

    const tokenHash = await walletClient.deployContract({
      abi: token.abi,
      bytecode: token.bytecode.object,
      args: [
        "합성 삼성전자 수탁권리",
        "SIM005930",
        anvilAccount.address,
        eligibilityAddress,
        policyAddress,
      ],
    });
    const tokenReceipt = await publicClient.waitForTransactionReceipt({ hash: tokenHash });
    const tokenAddress = tokenReceipt.contractAddress as Address;

    const foundation = await readRestrictedTokenFoundation(publicClient, tokenAddress);
    expect(eligibilityAddress).not.toBe("0x0000000000000000000000000000000000000000");
    expect(policyAddress).not.toBe("0x0000000000000000000000000000000000000000");
    expect(foundation).toEqual({
      name: "합성 삼성전자 수탁권리",
      symbol: "SIM005930",
      decimals: 0,
      totalSupply: 0n,
    });
  });
});
