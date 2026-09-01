export type ComplaintStatus =
  "SUBMITTED" | "ASSIGNED" | "IN_PROGRESS" | "RESPONSE_RECORDED" | "CORRECTION_REVIEW" | "CLOSED";

const complaintTransitions: Record<ComplaintStatus, readonly ComplaintStatus[]> = {
  SUBMITTED: ["ASSIGNED"],
  ASSIGNED: ["IN_PROGRESS"],
  IN_PROGRESS: ["RESPONSE_RECORDED"],
  RESPONSE_RECORDED: ["CORRECTION_REVIEW", "CLOSED"],
  CORRECTION_REVIEW: ["CLOSED"],
  CLOSED: [],
};

export function canTransitionComplaint(from: ComplaintStatus, to: ComplaintStatus): boolean {
  return complaintTransitions[from].includes(to);
}

export function complaintResponsibleInstitution(type: string): "PLATFORM" | "OVERSEAS_BROKER" {
  return type === "PLATFORM_TECHNICAL" ? "PLATFORM" : "OVERSEAS_BROKER";
}

export function walletOwnershipMessage(
  principalId: string,
  wallet: string,
  purpose: "LINK" | "REPLACE",
): string {
  return `K-EQUITY:${purpose}:${principalId}:${wallet.toLowerCase()}`;
}

export function parsePositiveLimit(value: unknown, fallback: number): number {
  const parsed = typeof value === "string" ? Number(value) : fallback;
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 100 ? parsed : fallback;
}
