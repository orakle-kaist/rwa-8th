import { parseAbi, type Abi, type Address, type Hex, type WalletClient } from "viem";

const secondaryIntent =
  "(bytes16 orderId,bytes16 quoteId,address investor,address token,string investorSide,string paymentMode,bytes32 paymentAssetId,uint256 shareQuantity,uint256 paymentAmountMinor,uint256 nonce,uint256 expiresAt,bytes32 policyVersion)";
const marketMakerQuote =
  "(bytes16 quoteId,address marketMaker,address token,string marketMakerSide,string paymentMode,bytes32 paymentAssetId,uint256 shareQuantity,uint256 unitPriceMinor,uint256 nonce,uint256 expiresAt,bytes32 policyVersion)";
const brokerApproval =
  "(bytes16 approvalId,bytes16 orderId,address investor,address marketMaker,address token,string paymentMode,bytes32 paymentAssetId,uint256 shareQuantity,uint256 paymentAmountMinor,bytes32 rightsEvidenceHash,bytes32 fundsEvidenceHash,uint256 nonce,uint256 expiresAt,bytes32 policyVersion)";

export const secondarySettlementControllerWriteAbi = parseAbi([
  `function settleUsdLedger(bytes16 workflowId,${secondaryIntent} investorIntent,bytes investorSignature,${marketMakerQuote} quote,bytes marketMakerSignature,${brokerApproval} approval,bytes brokerSignature,uint256 fillQuantity,uint256 paymentAmountMinor)`,
  `function settleUsdc(bytes16 workflowId,${secondaryIntent} investorIntent,bytes investorSignature,${marketMakerQuote} quote,bytes marketMakerSignature,${brokerApproval} approval,bytes brokerSignature,uint256 fillQuantity,uint256 paymentAmountMinor)`,
] as string[]) as Abi;

export async function writeSecondarySettlement(
  client: WalletClient,
  input: {
    controller: Address;
    functionName: "settleUsdLedger" | "settleUsdc";
    args: readonly unknown[];
  },
): Promise<Hex> {
  if (!client.account) throw new Error("24시간 정산 실행 계정이 필요하다.");
  return client.writeContract({
    address: input.controller,
    abi: secondarySettlementControllerWriteAbi,
    functionName: input.functionName,
    args: input.args,
    account: client.account,
    chain: client.chain,
  } as never);
}
