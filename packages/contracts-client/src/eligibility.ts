import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  parseAbi,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const anvilChain = defineChain({
  id: 31_337,
  name: "RWA PoC Anvil",
  nativeCurrency: { name: "Anvil Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["http://localhost:8545"] } },
});

const avalancheFuji = defineChain({
  id: 43_113,
  name: "Avalanche Fuji C-Chain",
  nativeCurrency: { name: "Avalanche", symbol: "AVAX", decimals: 18 },
  rpcUrls: { default: { http: ["https://api.avax-test.network/ext/bc/C/rpc"] } },
  testnet: true,
});

export const eligibilityRegistryWriteAbi = parseAbi([
  "function setEligibility(bytes16 workflowId,address wallet,bool eligible,uint256 validUntil,bytes32 evidenceHash)",
  "function isEligible(address wallet) view returns (bool)",
]);

export function uuidToBytes16(value: string): Hex {
  const canonical = value.replaceAll("-", "");
  if (!/^[0-9a-fA-F]{32}$/.test(canonical)) throw new Error("업무 ID는 UUID여야 한다.");
  return `0x${canonical}`;
}

export async function setWalletEligibility(input: {
  rpcUrl: string;
  chainId: 31_337 | 43_113;
  registryAddress: Address;
  operatorPrivateKey: Hex;
  workflowId: string;
  wallet: Address;
  validUntil: Date;
  evidenceHash: Hex;
}): Promise<Hex> {
  const chain = input.chainId === 43_113 ? avalancheFuji : anvilChain;
  const account = privateKeyToAccount(input.operatorPrivateKey);
  const transport = http(input.rpcUrl);
  const publicClient = createPublicClient({ chain, transport });
  const walletClient = createWalletClient({ account, chain, transport });
  const hash = await walletClient.writeContract({
    address: input.registryAddress,
    abi: eligibilityRegistryWriteAbi,
    functionName: "setEligibility",
    args: [
      uuidToBytes16(input.workflowId),
      input.wallet,
      true,
      BigInt(Math.floor(input.validUntil.getTime() / 1_000)),
      input.evidenceHash,
    ],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("적격성 등록 트랜잭션이 실패했다.");
  return hash;
}
