import { parseAbi, type Address, type PublicClient } from "viem";

export const restrictedEquityTokenReadAbi = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() pure returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function availableBalanceOf(address account) view returns (uint256)",
  "function pendingSettlementBalanceOf(address account) view returns (uint256)",
  "function redemptionLockedBalanceOf(address account) view returns (uint256)",
  "function burnPendingBalanceOf(address account) view returns (uint256)",
  "function administrativeFrozenBalanceOf(address account) view returns (uint256)",
]);

export async function readRestrictedTokenFoundation(client: PublicClient, tokenAddress: Address) {
  const [name, symbol, decimals, totalSupply] = await Promise.all([
    client.readContract({
      address: tokenAddress,
      abi: restrictedEquityTokenReadAbi,
      functionName: "name",
    }),
    client.readContract({
      address: tokenAddress,
      abi: restrictedEquityTokenReadAbi,
      functionName: "symbol",
    }),
    client.readContract({
      address: tokenAddress,
      abi: restrictedEquityTokenReadAbi,
      functionName: "decimals",
    }),
    client.readContract({
      address: tokenAddress,
      abi: restrictedEquityTokenReadAbi,
      functionName: "totalSupply",
    }),
  ]);

  return { name, symbol, decimals, totalSupply };
}
