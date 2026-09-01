import { parseAbi, type Abi, type Address, type Hex, type WalletClient } from "viem";

const redemptionIntent =
  "(bytes16 redemptionId,address investor,address token,uint256 shareQuantity,uint256 krwLimitPrice,string targetTradingDate,uint256 nonce,uint256 expiresAt,bytes32 policyVersion)";

export const redemptionControllerWriteAbi = parseAbi([
  `function lockRedemption(bytes16 workflowId,${redemptionIntent} intent,bytes investorSignature)`,
  "function cancelBeforeDomesticSale(bytes16 workflowId,bytes32 evidenceHash)",
  "function markDomesticSaleSubmitted(bytes16 workflowId,bytes32 evidenceHash)",
  "function confirmDomesticExecution(bytes16 workflowId,uint256 executedQuantity,bytes32 evidenceHash)",
  "function confirmSaleProceedsSettled(bytes16 workflowId,uint256 quantity,uint256 usdAmountMinor,bytes32 evidenceHash)",
  "function confirmRightsTerminated(bytes16 workflowId,address token,address investor,uint256 quantity,bytes32 evidenceHash)",
  "function confirmCashClaim(bytes16 workflowId,uint256 quantity,uint256 usdAmountMinor,bytes32 evidenceHash)",
  "function markBurnPending(bytes16 workflowId)",
  "function approveUsdPayment(bytes16 workflowId,uint256 usdAmountMinor,bytes32 evidenceHash)",
  "function executeBurn(bytes16 workflowId)",
] as string[]) as Abi;

export async function writeRedemptionController(
  client: WalletClient,
  input: {
    controller: Address;
    functionName:
      | "lockRedemption"
      | "cancelBeforeDomesticSale"
      | "markDomesticSaleSubmitted"
      | "confirmDomesticExecution"
      | "confirmSaleProceedsSettled"
      | "confirmRightsTerminated"
      | "confirmCashClaim"
      | "markBurnPending"
      | "approveUsdPayment"
      | "executeBurn";
    args: readonly unknown[];
  },
): Promise<Hex> {
  if (!client.account) throw new Error("환매 실행 계정이 필요하다.");
  return client.writeContract({
    address: input.controller,
    abi: redemptionControllerWriteAbi,
    functionName: input.functionName,
    args: input.args,
    account: client.account,
    chain: client.chain,
  } as never);
}
