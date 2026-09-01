import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  padHex,
  parseEther,
  toHex,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";

import { anvilChain, writeSecondarySettlement } from "../src/index.js";

const root = resolve(import.meta.dirname, "../../..");
const administrator = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex,
);
const investor = privateKeyToAccount(keccak256(toHex("secondary-investor-b")));
const marketMaker = privateKeyToAccount(keccak256(toHex("secondary-market-maker")));
const broker = privateKeyToAccount(keccak256(toHex("secondary-broker")));

type Artifact = { abi: Abi; bytecode: { object: Hex } };
async function artifact(name: string): Promise<Artifact> {
  return JSON.parse(
    await readFile(resolve(root, `contracts/out/${name}.sol/${name}.json`), "utf8"),
  ) as Artifact;
}

const secondaryTypes = {
  SecondaryOrderIntent: [
    { name: "orderId", type: "bytes16" },
    { name: "quoteId", type: "bytes16" },
    { name: "investor", type: "address" },
    { name: "token", type: "address" },
    { name: "investorSide", type: "string" },
    { name: "paymentMode", type: "string" },
    { name: "paymentAssetId", type: "bytes32" },
    { name: "shareQuantity", type: "uint256" },
    { name: "paymentAmountMinor", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "expiresAt", type: "uint256" },
    { name: "policyVersion", type: "bytes32" },
  ],
  MarketMakerQuote: [
    { name: "quoteId", type: "bytes16" },
    { name: "marketMaker", type: "address" },
    { name: "token", type: "address" },
    { name: "marketMakerSide", type: "string" },
    { name: "paymentMode", type: "string" },
    { name: "paymentAssetId", type: "bytes32" },
    { name: "shareQuantity", type: "uint256" },
    { name: "unitPriceMinor", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "expiresAt", type: "uint256" },
    { name: "policyVersion", type: "bytes32" },
  ],
  BrokerSettlementApproval: [
    { name: "approvalId", type: "bytes16" },
    { name: "orderId", type: "bytes16" },
    { name: "investor", type: "address" },
    { name: "marketMaker", type: "address" },
    { name: "token", type: "address" },
    { name: "paymentMode", type: "string" },
    { name: "paymentAssetId", type: "bytes32" },
    { name: "shareQuantity", type: "uint256" },
    { name: "paymentAmountMinor", type: "uint256" },
    { name: "rightsEvidenceHash", type: "bytes32" },
    { name: "fundsEvidenceHash", type: "bytes32" },
    { name: "nonce", type: "uint256" },
    { name: "expiresAt", type: "uint256" },
    { name: "policyVersion", type: "bytes32" },
  ],
} as const;

describe("Anvil 24시간 제한 거래", () => {
  it("USDC 8주 주문을 5주만 원자적으로 체결하고 결제대기 20주는 유지한다", async () => {
    const rpc = process.env.ANVIL_RPC_URL ?? "http://127.0.0.1:8545";
    const transport = http(rpc);
    const publicClient = createPublicClient({ chain: anvilChain, transport });
    const adminWallet = createWalletClient({
      account: administrator,
      chain: anvilChain,
      transport,
    });
    const investorWallet = createWalletClient({ account: investor, chain: anvilChain, transport });
    const deploy = async (name: string, args: readonly unknown[]) => {
      const item = await artifact(name);
      const hash = await adminWallet.deployContract({
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
      wallet = adminWallet,
    ) => {
      const hash = await wallet.writeContract({
        address,
        abi,
        functionName,
        args,
        account: wallet.account!,
        chain: anvilChain,
      } as never);
      await publicClient.waitForTransactionReceipt({ hash });
    };
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
    const controller = await deploy("SecondarySettlementController", [
      administrator.address,
      verifier,
      eligibility,
      policy,
    ]);
    const usdc = await deploy("MockUsdc", []);
    const eligibilityAbi = (await artifact("EligibilityRegistry")).abi;
    const verifierAbi = (await artifact("IntentVerifier")).abi;
    const tokenAbi = (await artifact("RestrictedEquityToken")).abi;
    const controllerAbi = (await artifact("SecondarySettlementController")).abi;
    const usdcAbi = (await artifact("MockUsdc")).abi;
    const role = (name: string) => keccak256(toHex(name));
    const workflow = (number: number) => `0x${number.toString(16).padStart(32, "0")}` as Hex;
    const evidence = (label: string) => keccak256(toHex(label));
    const latestBlock = await publicClient.getBlock();
    const expiresAt = latestBlock.timestamp + 3_600n;

    const fundingHash = await adminWallet.sendTransaction({
      to: investor.address,
      value: parseEther("1"),
    });
    await publicClient.waitForTransactionReceipt({ hash: fundingHash });
    await write(eligibility, eligibilityAbi, "grantRole", [
      role("ELIGIBILITY_OPERATOR_ROLE"),
      administrator.address,
    ]);
    for (const [number, account] of [
      [1, investor.address],
      [2, marketMaker.address],
    ] as const)
      await write(eligibility, eligibilityAbi, "setEligibility", [
        workflow(number),
        account,
        true,
        expiresAt,
        evidence(`eligible-${number}`),
      ]);
    await write(eligibility, eligibilityAbi, "setMarketMaker", [
      workflow(3),
      marketMaker.address,
      true,
      expiresAt,
      evidence("market-maker"),
    ]);
    await write(token, tokenAbi, "grantRole", [
      role("ISSUANCE_EXECUTOR_ROLE"),
      administrator.address,
    ]);
    await write(token, tokenAbi, "grantRole", [role("SETTLEMENT_EXECUTOR_ROLE"), controller]);
    await write(verifier, verifierAbi, "grantRole", [role("SETTLEMENT_EXECUTOR_ROLE"), controller]);
    await write(controller, controllerAbi, "grantRole", [
      role("SETTLEMENT_EXECUTOR_ROLE"),
      administrator.address,
    ]);
    await write(verifier, verifierAbi, "setBrokerSettlementSigner", [
      workflow(4),
      broker.address,
      evidence("broker-signer"),
    ]);
    await write(token, tokenAbi, "mintPending", [
      workflow(5),
      marketMaker.address,
      120n,
      evidence("initial-rights"),
    ]);
    await write(token, tokenAbi, "releasePending", [
      workflow(6),
      marketMaker.address,
      100n,
      evidence("initial-settlement"),
    ]);
    await write(usdc, usdcAbi, "mint", [investor.address, 10_000n * 1_000_000n]);
    await write(usdc, usdcAbi, "approve", [controller, 10_000n * 1_000_000n], investorWallet);

    const paymentAssetId = padHex(usdc, { size: 32 });
    const order = {
      orderId: workflow(10),
      quoteId: workflow(11),
      investor: investor.address,
      token,
      investorSide: "BUY",
      paymentMode: "USDC_ONCHAIN",
      paymentAssetId,
      shareQuantity: 8n,
      paymentAmountMinor: 9_628_400_000n,
      nonce: 101n,
      expiresAt,
      policyVersion,
    };
    const quote = {
      quoteId: order.quoteId,
      marketMaker: marketMaker.address,
      token,
      marketMakerSide: "SELL",
      paymentMode: order.paymentMode,
      paymentAssetId,
      shareQuantity: 5n,
      unitPriceMinor: 1_203_550_000n,
      nonce: 102n,
      expiresAt,
      policyVersion,
    };
    const approval = {
      approvalId: workflow(12),
      orderId: order.orderId,
      investor: investor.address,
      marketMaker: marketMaker.address,
      token,
      paymentMode: order.paymentMode,
      paymentAssetId,
      shareQuantity: 5n,
      paymentAmountMinor: 6_017_750_000n,
      rightsEvidenceHash: evidence("rights-reservation"),
      fundsEvidenceHash: evidence("funds-reservation"),
      nonce: 103n,
      expiresAt,
      policyVersion,
    };
    const domain = {
      name: "Korean Equity RWA Intent",
      version: "1",
      chainId: 31_337,
      verifyingContract: verifier,
    } as const;
    const investorSignature = await investor.signTypedData({
      domain,
      types: { SecondaryOrderIntent: secondaryTypes.SecondaryOrderIntent },
      primaryType: "SecondaryOrderIntent",
      message: order,
    });
    const marketMakerSignature = await marketMaker.signTypedData({
      domain,
      types: { MarketMakerQuote: secondaryTypes.MarketMakerQuote },
      primaryType: "MarketMakerQuote",
      message: quote,
    });
    const brokerSignature = await broker.signTypedData({
      domain,
      types: { BrokerSettlementApproval: secondaryTypes.BrokerSettlementApproval },
      primaryType: "BrokerSettlementApproval",
      message: approval,
    });

    const settlementHash = await writeSecondarySettlement(adminWallet, {
      controller,
      functionName: "settleUsdc",
      args: [
        order.orderId,
        order,
        investorSignature,
        quote,
        marketMakerSignature,
        approval,
        brokerSignature,
        5n,
        6_017_750_000n,
      ],
    });
    await publicClient.waitForTransactionReceipt({ hash: settlementHash });

    expect(
      await publicClient.readContract({
        address: token,
        abi: tokenAbi,
        functionName: "availableBalanceOf",
        args: [investor.address],
      }),
    ).toBe(5n);
    expect(
      await publicClient.readContract({
        address: token,
        abi: tokenAbi,
        functionName: "availableBalanceOf",
        args: [marketMaker.address],
      }),
    ).toBe(95n);
    expect(
      await publicClient.readContract({
        address: token,
        abi: tokenAbi,
        functionName: "pendingSettlementBalanceOf",
        args: [marketMaker.address],
      }),
    ).toBe(20n);
    expect(
      await publicClient.readContract({
        address: usdc,
        abi: usdcAbi,
        functionName: "balanceOf",
        args: [marketMaker.address],
      }),
    ).toBe(6_017_750_000n);
    expect(
      await publicClient.readContract({
        address: token,
        abi: tokenAbi,
        functionName: "totalSupply",
      }),
    ).toBe(120n);
  });
});
