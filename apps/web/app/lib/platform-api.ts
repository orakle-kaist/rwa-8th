const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:4000/api/v1";

export const demoTokens = {
  investorA: "demo:investor-a",
  investorB: "demo:investor-b",
  denied: "demo:investor-denied",
  expired: "demo:investor-expired",
} as const;

export async function platformFetch<T>(
  path: string,
  input: { token?: string; method?: "GET" | "POST"; body?: unknown } = {},
): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (input.token) headers.Authorization = `Bearer ${input.token}`;
  if (input.method === "POST") {
    headers["Idempotency-Key"] = crypto.randomUUID();
    headers["X-Correlation-Id"] = crypto.randomUUID();
  }
  const response = await fetch(`${API_BASE}${path}`, {
    method: input.method ?? "GET",
    headers,
    ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
  });
  const data = (await response.json()) as T & { messageKo?: string };
  if (!response.ok) throw new Error(data.messageKo ?? `요청 실패 (${response.status})`);
  return data;
}

export async function allProducts(): Promise<Product[]> {
  const products: Product[] = [];
  let cursor: string | undefined;
  do {
    const page: ProductPage = await platformFetch(
      `/products?limit=100${cursor ? `&cursor=${cursor}` : ""}`,
    );
    products.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return products;
}

export interface Product {
  securityId: string;
  nameKo: string;
  referenceVersion: string;
  representative: boolean;
  candidateStatus: string;
  availability: { primary: string; secondary: string; redemption: string };
  blockingReasons: Array<{ code: string; messageKo: string }>;
  notices: Record<string, string>;
  simulation: true;
}

export interface ProductPage {
  items: Product[];
  nextCursor?: string;
}

export interface Readiness {
  eligibility: string;
  investorProtection: string;
  wallet: string;
  activeWallet?: string;
  canPlaceNewOrder: boolean;
  canReceiveRights: boolean;
  blockingReasons: Array<{ code: string; messageKo: string; nextActionKo: string }>;
}

export interface Session {
  actorId: string;
  role: string;
  customerReadiness?: Readiness;
  localPrimaryScenario?: LocalPrimaryScenario;
  localSecondaryScenario?: LocalSecondaryScenario;
  localRedemptionScenario?: LocalRedemptionScenario;
  localRightsScenario?: LocalRightsScenario;
  projection: { projectionAsOf: string; lastEventSequence: number; projectionStatus: string };
  simulation: true;
}

export interface LocalRightsScenario {
  securityId: string;
  dividend?: {
    eventId: string;
    recordDate: string;
    exDate: string;
    status: string;
    grossPerShareUsdMinor: string;
    domesticTotalUsdMinor: string;
    paymentId?: string;
    eligibleQuantity?: string;
    netUsdMinor?: string;
    paymentStatus?: string;
    quoteId?: string;
    quoteExpiresAt?: string;
    conversionStatus?: string;
    usdcPaidMinor?: string;
  };
  voting?: {
    meetingId: string;
    agendaId: string;
    titleKo: string;
    recordDate: string;
    instructionDeadline: string;
    eligibleQuantity: string;
    status: string;
    instruction?: "FOR" | "AGAINST" | "ABSTAIN";
    aggregateResult?: Record<string, string>;
    standingProxyResultEvidenceHash?: string;
  };
  recovery?: {
    workflow_id: string;
    old_wallet: string;
    new_wallet: string;
    rights_approved: boolean;
    compliance_approved: boolean;
    chain_executed: boolean;
    rights_ledger_updated: boolean;
    reconciled: boolean;
    status: string;
    transaction_hash?: string;
  };
  corporateAction?: Record<string, unknown> & { status: string; security_id: string };
  notices: string[];
  simulation: true;
}

export interface OperationalHold extends Workflow {
  securityId?: string;
  scope: string;
  reasonCode: string;
}

export interface RegulatoryReport extends Workflow {
  reportingMonth: string;
  dueDate: string;
  recordCount: number;
  retentionUntil: string;
  receiptReference?: string;
}

export interface LocalPrimaryScenario {
  securityId: string;
  displayName: string;
  tokenSymbol: string;
  referenceLimitKrw: string;
  usdKrwRate: string;
  policyVersion: string;
  intentDomain: {
    name: string;
    version: string;
    chainId: number;
    verifyingContract: `0x${string}`;
  };
  cash?: { usdAvailableMinor: string; usdReservedMinor: string; usdcAvailableMinor: string };
  notices: string[];
  simulation: true;
}

export interface PrimaryOrder {
  orderId: string;
  securityId: string;
  shareQuantity: string;
  krwLimitPrice: string;
  fundingMode: string;
  requestedUsdMinor: string;
  convertedUsdcMinor: string;
  filledQuantity: string;
  allocatedQuantity: string;
  status: string;
  rightsStatus: string;
  tokenStatus: string;
  settlementStatus: string;
  quarantineReason?: string;
  defaultResolution?: "REPLACEMENT_SHARES" | "CASH_COMPENSATION";
  cashCompensationUsdMinor?: string;
}

export interface LocalSecondaryScenario {
  securityId: string;
  displayName: string;
  tokenSymbol: string;
  tokenAddress: `0x${string}`;
  mockUsdcAddress: `0x${string}`;
  referenceSecurityId: string;
  referenceUsdMinor: string;
  normalAskUsdMinor: string;
  informationEffectiveAt: string;
  usdcUsd: string;
  halfSpreadBps: number;
  secondaryEnabled: boolean;
  policyVersion: string;
  intentDomain: LocalPrimaryScenario["intentDomain"];
  balances: {
    settledRights: string;
    pendingRights: string;
    reservedRights: string;
    usdAvailableMinor: string;
    usdReservedMinor: string;
    usdcAvailableMinor: string;
    usdcReservedMinor: string;
  };
  notices: string[];
  simulation: true;
}

export interface SecondaryQuote {
  quoteId: string;
  securityId: string;
  designatedMarketMaker: string;
  marketMakerSide: "BUY" | "SELL";
  investorSide: "BUY" | "SELL";
  fundingMode: "USD_LEDGER" | "USDC_ONCHAIN";
  paymentAssetId: `0x${string}`;
  tokenAddress: `0x${string}`;
  remainingQuantity: string;
  unitPrice: { currency: "USD" | "USDC"; amountMinor: string; decimals: 2 | 6 };
  halfSpreadBps: number;
  status: string;
  expiresAt: string;
  simulation: true;
}

export interface SecondaryOrder {
  orderId: string;
  quoteId: string;
  securityId: string;
  investorSide: "BUY" | "SELL";
  fundingMode: "USD_LEDGER" | "USDC_ONCHAIN";
  investorWallet: `0x${string}`;
  marketMakerWallet: `0x${string}`;
  tokenAddress: `0x${string}`;
  paymentAssetId: `0x${string}`;
  requestedQuantity: string;
  fillQuantity: string;
  cancelledQuantity: string;
  unitPriceMinor: string;
  paymentAmountMinor: string;
  rightsReservedQuantity: string;
  rightsReservationReleasedQuantity: string;
  fundsReservedMinor: string;
  fundsReservationReleasedMinor: string;
  rightsFinalized: boolean;
  fundsFinalized: boolean;
  chainFinalized: boolean;
  status: string;
  investorIntentMessage?: Record<string, string>;
  marketMakerQuoteMessage?: Record<string, string>;
  chainTransactionHash?: string;
  quarantineReason?: string;
  simulation: true;
}

export interface MarketMakerPosition {
  securityId: string;
  settledInventory: string;
  pendingInventory: string;
  reservedInventory: string;
  netPosition: string;
  nextSessionStartingInventory: string;
  riskReducingOnly: boolean;
  quoteDirectionBlocked?: "BUY" | "SELL";
  hedgeHoldReasonKo?: string;
  positionLimit: string;
  usdAvailableMinor: string;
  usdReservedMinor: string;
  usdcAvailableMinor: string;
  usdcReservedMinor: string;
  securityLossBps: number;
  portfolioLossBps: number;
  secondaryPaused: boolean;
  usdcPaused: boolean;
  simulation: true;
}

export interface MarketMakerHedge {
  hedgeId: string;
  securityId: string;
  direction: "BUY" | "SELL";
  requestedQuantity: string;
  filledQuantity: string;
  remainingQuantity: string;
  netPositionSnapshot: string;
  krwLimitPrice: string;
  targetTradingDate: string;
  status: string;
  aggregateVersion: number;
  riskViolationReducing: boolean;
  positionUtilizationBps: number;
  foreignLimitStatus: "ALLOWED" | "BLOCKED" | "UNKNOWN";
  krxStatus: "OPEN" | "CLOSED" | "HALTED";
  marketMakerConfirmed: boolean;
  brokerRiskApproved: boolean;
  domesticSettlementConfirmed: boolean;
  custodyQuantityConfirmed: boolean;
  usdPaymentConfirmed: boolean;
  sourceSecondaryOrderIds: string[];
  history: Array<{
    state: string;
    actorRole: string;
    occurredAt: string;
    evidenceHash?: string;
    reasonKo?: string;
  }>;
  domesticOrderReference?: string;
  holdReasonKo?: string;
  simulation: true;
}

export interface LocalRedemptionScenario {
  securityId: "990001";
  displayName: string;
  tokenAddress: `0x${string}`;
  referenceLimitKrw: "257000";
  redemptionEnabled: boolean;
  settledQuantity: string;
  availableQuantity: string;
  redemptionLockedQuantity: string;
  burnPendingQuantity: string;
  domesticSettledQuantity: string;
  tokenTotalSupply: string;
  policyVersion: "REDEMPTION-SIM-1";
  intentDomain: LocalPrimaryScenario["intentDomain"];
  notices: string[];
  simulation: true;
}

export interface Redemption {
  redemptionId: string;
  securityId: "990001";
  requestedQuantity: string;
  allocatedQuantity: string;
  releasedQuantity: string;
  krwLimitPrice: string;
  status: string;
  domesticSaleSubmitted: boolean;
  domesticExecutionConfirmed: boolean;
  saleProceedsSettled: boolean;
  rightsTerminated: boolean;
  cashClaimUsdMinor?: string;
  feeUsdMinor: "0";
  tokenBurned: boolean;
  usdPaid: boolean;
  quarantineReasonKo?: string;
  simulation: true;
}

export interface Disclosure {
  disclosureId: string;
  version: string;
  titleKo: string;
  sections: Array<{ code: string; titleKo: string; summaryKo: string }>;
  validUntil: string;
  responsibleInstitutionId: string;
  simulation: true;
}

export interface Consent {
  status: "MISSING" | "VALID" | "EXPIRED";
  version: string;
  simulation: true;
}

export interface Complaint {
  complaintId: string;
  type: string;
  titleKo: string;
  descriptionKo: string;
  status: string;
  responsibleInstitutionId?: string;
  responseReferenceId?: string;
  correctionWorkflowId?: string;
  simulation: true;
}

export interface Workflow {
  workflowId: string;
  workflowType: string;
  states: Array<{ axis: string; code: string; labelKo: string }>;
  simulation: true;
}
