import { parseAbi, type Abi, type Address, type Hex, type WalletClient } from "viem";

export const recoveryControllerWriteAbi = parseAbi([
  "function approveRightsRecovery(bytes16 workflowId,address oldWallet,address newWallet,bytes32 evidenceHash)",
  "function approveComplianceRecovery(bytes16 workflowId,address oldWallet,address newWallet,bytes32 evidenceHash)",
  "function executeRecovery(bytes16 workflowId,address token,address oldWallet,address newWallet)",
] as string[]) as Abi;

export const corporateActionControllerWriteAbi = parseAbi([
  "function approveRightsPlan(bytes16 workflowId,address token,uint256 numerator,uint256 denominator,uint256 expectedSupply,bytes32 evidenceHash)",
  "function approveAuditPlan(bytes16 workflowId,address token,uint256 numerator,uint256 denominator,uint256 expectedSupply,bytes32 evidenceHash)",
  "function applySplitBatch(bytes16 workflowId,address token,address[] accounts)",
  "function finalizeSplit(bytes16 workflowId)",
] as string[]) as Abi;

async function write(
  client: WalletClient,
  address: Address,
  abi: Abi,
  functionName: string,
  args: readonly unknown[],
): Promise<Hex> {
  if (!client.account) throw new Error("권리업무 실행 계정이 필요하다.");
  return client.writeContract({
    address,
    abi,
    functionName,
    args,
    account: client.account,
    chain: client.chain,
  } as never);
}

export function writeRecoveryController(
  client: WalletClient,
  input: {
    controller: Address;
    functionName: "approveRightsRecovery" | "approveComplianceRecovery" | "executeRecovery";
    args: readonly unknown[];
  },
) {
  return write(
    client,
    input.controller,
    recoveryControllerWriteAbi,
    input.functionName,
    input.args,
  );
}

export function writeCorporateActionController(
  client: WalletClient,
  input: {
    controller: Address;
    functionName:
      "approveRightsPlan" | "approveAuditPlan" | "applySplitBatch" | "finalizeSplit";
    args: readonly unknown[];
  },
) {
  return write(
    client,
    input.controller,
    corporateActionControllerWriteAbi,
    input.functionName,
    input.args,
  );
}
