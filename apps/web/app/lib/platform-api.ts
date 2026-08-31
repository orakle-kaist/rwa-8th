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
  simulation: true;
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
