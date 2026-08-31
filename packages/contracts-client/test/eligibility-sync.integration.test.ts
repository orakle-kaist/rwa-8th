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

import { anvilChain, eligibilityRegistryWriteAbi, setWalletEligibility } from "../src/index.js";

const repositoryRoot = resolve(import.meta.dirname, "../../..");
const operatorKey = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex;
const operator = privateKeyToAccount(operatorKey);

type ForgeArtifact = { abi: Abi; bytecode: { object: Hex } };

describe("전용 지갑 적격성 체인 반영", () => {
  it("권한 있는 작업자가 등록한 지갑만 유효하게 조회한다", async () => {
    const rpcUrl = process.env.ANVIL_RPC_URL ?? "http://127.0.0.1:8545";
    const artifact = JSON.parse(
      await readFile(
        resolve(repositoryRoot, "contracts/out/EligibilityRegistry.sol/EligibilityRegistry.json"),
        "utf8",
      ),
    ) as ForgeArtifact;
    const transport = http(rpcUrl);
    const publicClient = createPublicClient({ chain: anvilChain, transport });
    const walletClient = createWalletClient({ account: operator, chain: anvilChain, transport });
    const deployment = await walletClient.deployContract({
      abi: artifact.abi,
      bytecode: artifact.bytecode.object,
      args: [operator.address],
    });
    const deploymentReceipt = await publicClient.waitForTransactionReceipt({ hash: deployment });
    const registryAddress = deploymentReceipt.contractAddress as Address;
    const role = keccak256(toHex("ELIGIBILITY_OPERATOR_ROLE"));
    const grantHash = await walletClient.writeContract({
      address: registryAddress,
      abi: artifact.abi,
      functionName: "grantRole",
      args: [role, operator.address],
    });
    await publicClient.waitForTransactionReceipt({ hash: grantHash });

    const customer = "0x00000000000000000000000000000000000000a1" as Address;
    const hash = await setWalletEligibility({
      rpcUrl,
      chainId: 31_337,
      registryAddress,
      operatorPrivateKey: operatorKey,
      workflowId: "00000000-0000-4000-8000-000000009901",
      wallet: customer,
      validUntil: new Date("2027-08-31T00:00:00Z"),
      evidenceHash: `0x${"31".repeat(32)}`,
    });
    expect(hash).toMatch(/^0x[0-9a-f]{64}$/i);
    expect(
      await publicClient.readContract({
        address: registryAddress,
        abi: eligibilityRegistryWriteAbi,
        functionName: "isEligible",
        args: [customer],
      }),
    ).toBe(true);
  });
});
