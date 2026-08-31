import { parseAbi, type Address, type Hex, type WalletClient } from "viem";

export const issuanceControllerWriteAbi = parseAbi([
  "function confirmExecutionAllocation(bytes16 workflowId,address token,address investor,uint256 executedQuantity,uint256 allocatedQuantity,bytes32 executionEvidenceHash,bytes32 allocationEvidenceHash)",
  "function approveT2Risk(bytes16 workflowId,address token,address investor,uint256 quantity,bytes32 evidenceHash)",
  "function approveRightsEntry(bytes16 workflowId,address token,address investor,uint256 quantity,bytes32 evidenceHash)",
  "function confirmRightsRecorded(bytes16 workflowId,address token,address investor,uint256 quantity,bytes32 evidenceHash)",
  "function confirmDomesticSettlement(bytes16 workflowId,address token,address investor,uint256 quantity,bytes32 evidenceHash)",
  "function confirmCustodyQuantity(bytes16 workflowId,address token,address investor,uint256 quantity,bytes32 evidenceHash)",
  "function executeRelease(bytes16 workflowId,address token,address investor,uint256 quantity)",
  "function approvePendingCorrection(bytes16 correctionId,bytes16 issuanceWorkflowId,address token,address investor,uint256 quantity,bytes32 evidenceHash)",
  "function confirmPendingRightsCorrection(bytes16 correctionId,uint256 quantity,bytes32 evidenceHash)",
  "function executePendingCorrection(bytes16 correctionId)",
]);

export async function writeIssuanceController(
  client: WalletClient,
  input: {
    controller: Address;
    functionName: (typeof issuanceControllerWriteAbi)[number]["name"];
    args: readonly unknown[];
  },
): Promise<Hex> {
  if (!client.account) throw new Error("컨트랙트 실행 계정이 필요하다.");
  return client.writeContract({
    address: input.controller,
    abi: issuanceControllerWriteAbi,
    functionName: input.functionName,
    args: input.args,
    account: client.account,
    chain: client.chain,
  } as never);
}
