export const demoPrincipals = {
  "demo:investor-a": {
    principalId: "00000000-0000-4000-8000-000000000001",
    role: "INVESTOR",
    displayName: "합성 투자자 A",
  },
  "demo:investor-b": {
    principalId: "00000000-0000-4000-8000-000000000002",
    role: "INVESTOR",
    displayName: "합성 투자자 B",
  },
  "demo:investor-denied": {
    principalId: "00000000-0000-4000-8000-000000000003",
    role: "INVESTOR",
    displayName: "합성 거절 고객",
  },
  "demo:investor-expired": {
    principalId: "00000000-0000-4000-8000-000000000004",
    role: "INVESTOR",
    displayName: "합성 만료 고객",
  },
  "demo:platform-operator": {
    principalId: "00000000-0000-4000-8000-000000000101",
    role: "PLATFORM_OPERATOR",
    displayName: "토큰 플랫폼 운영자",
  },
  "demo:broker-operator": {
    principalId: "00000000-0000-4000-8000-000000000102",
    role: "OVERSEAS_BROKER_OPERATOR",
    displayName: "인가 해외 증권사 담당자",
  },
  "demo:market-maker": {
    principalId: "00000000-0000-4000-8000-000000000103",
    role: "MARKET_MAKER",
    displayName: "지정 시장조성자",
  },
  "demo:compliance-auditor": {
    principalId: "00000000-0000-4000-8000-000000000104",
    role: "COMPLIANCE_AUDITOR",
    displayName: "준법·감사 담당자",
  },
  "demo:execution-confirmer": {
    principalId: "00000000-0000-4000-8000-000000000105",
    role: "EXECUTION_ALLOCATION_CONFIRMER",
    displayName: "국내 체결·배분 확인 담당자",
  },
  "demo:risk-approver": {
    principalId: "00000000-0000-4000-8000-000000000106",
    role: "T2_RISK_APPROVER",
    displayName: "T+2 위험 승인 담당자",
  },
  "demo:rights-approver": {
    principalId: "00000000-0000-4000-8000-000000000107",
    role: "RIGHTS_ENTRY_APPROVER",
    displayName: "권리기입 승인 담당자",
  },
  "demo:rights-recorder": {
    principalId: "00000000-0000-4000-8000-000000000108",
    role: "RIGHTS_RECORDING_CONFIRMER",
    displayName: "권리 원장 반영 확인 담당자",
  },
  "demo:settlement-confirmer": {
    principalId: "00000000-0000-4000-8000-000000000109",
    role: "DOMESTIC_SETTLEMENT_CONFIRMER",
    displayName: "국내 결제 확인 담당자",
  },
  "demo:custody-confirmer": {
    principalId: "00000000-0000-4000-8000-000000000110",
    role: "CUSTODY_QUANTITY_CONFIRMER",
    displayName: "수탁수량 확인 담당자",
  },
} as const;

export type DemoToken = keyof typeof demoPrincipals;
export type DemoPrincipal = (typeof demoPrincipals)[DemoToken];

export function authenticateDemoBearer(authorization: string | undefined): DemoPrincipal | null {
  if (!authorization?.startsWith("Bearer ")) {
    return null;
  }
  const token = authorization.slice("Bearer ".length) as DemoToken;
  return demoPrincipals[token] ?? null;
}
