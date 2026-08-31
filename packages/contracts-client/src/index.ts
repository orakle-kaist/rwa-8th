import { createPublicClient, defineChain, http, type PublicClient } from "viem";

export const anvilChain = defineChain({
  id: 31_337,
  name: "RWA PoC Anvil",
  nativeCurrency: { name: "Anvil Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["http://localhost:8545"] } },
});

export const avalancheFuji = defineChain({
  id: 43_113,
  name: "Avalanche Fuji C-Chain",
  nativeCurrency: { name: "Avalanche", symbol: "AVAX", decimals: 18 },
  rpcUrls: { default: { http: ["https://api.avax-test.network/ext/bc/C/rpc"] } },
  testnet: true,
});

export function createChainReader(rpcUrl: string, chainId: 31_337 | 43_113): PublicClient {
  const chain = chainId === 43_113 ? avalancheFuji : anvilChain;
  return createPublicClient({ chain, transport: http(rpcUrl) });
}
