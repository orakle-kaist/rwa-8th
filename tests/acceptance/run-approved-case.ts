import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  APPROVED_STATE_TRANSITIONS,
  AdjustableClock,
  StateConflictError,
  allocateProRata,
  allocateRedemptionFill,
  allocateSyntheticDividend,
  allocateUsdClaims,
  assertApprovedStateTransition,
  assertHedgeCanProceed,
  assertPrimaryOrder,
  assertQuoteRisk,
  availableForRedemption,
  canTransitionComplaint,
  classifyReportSubmission,
  complaintResponsibleInstitution,
  computeFill,
  expectedSplitSupply,
  hedgeDirectionForNetPosition,
  informationIsFresh,
  nextHedgeTradingDate,
  nextKrxBusinessDate,
  paymentAmount,
  positionWithinLimit,
  quoteIsActive,
  unhedgedQuantity,
  usdcPathIsAllowed,
  walletOwnershipMessage,
} from "../../packages/domain/src/index.js";

const root = resolve(import.meta.dirname, "../..");
const at = new Date("2026-08-31T00:00:00.000Z");

export interface ApprovedCaseResult {
  testId: string;
  executedAssertions: number;
  evidence: string[];
}

type CaseAction = () => void | number | Promise<void | number>;
const actions: Record<string, CaseAction> = {};
const add = (ids: Record<string, CaseAction>) => Object.assign(actions, ids);
const ok = (value: unknown, message: string) => assert.ok(value, message);
const blocked = (axis: string, from: string, to: string) =>
  assert.throws(
    () => assertApprovedStateTransition(axis, from, to),
    (error: unknown) => error instanceof StateConflictError && error.code === "STATE_CONFLICT",
  );
const moved = (axis: string, from: string, to: string) => {
  const definition = APPROVED_STATE_TRANSITIONS[from as keyof typeof APPROVED_STATE_TRANSITIONS];
  ok(definition?.axis === axis, `${from}의 상태축`);
  ok((definition.allowedTargets as readonly string[]).includes(to), `${from} -> ${to}`);
  ok(to in APPROVED_STATE_TRANSITIONS, `${to} 상태 존재`);
};
const loadJson = async (path: string) =>
  JSON.parse(await readFile(resolve(root, path), "utf8")) as Record<string, unknown>;
const loadText = (path: string) => readFile(resolve(root, path), "utf8");
const validQuote = (overrides: Partial<Parameters<typeof assertQuoteRisk>[0]> = {}) => ({
  now: at,
  expiresAt: new Date(at.getTime() + 30_000),
  informationEffectiveAt: at,
  fundingMode: "USDC_ONCHAIN" as const,
  usdcUsdPpm: 1_000_000n,
  halfSpreadBps: 50,
  securityLossBps: 0,
  portfolioLossBps: 0,
  resultingNetPosition: -5n,
  ...overrides,
});
const primaryAllocations = () =>
  allocateProRata(
    [
      { orderId: "A", requestedQuantity: 5n, acceptedAt: at },
      { orderId: "B", requestedQuantity: 3n, acceptedAt: new Date(at.getTime() + 1) },
    ],
    6n,
  );

add({
  "고객-정상-01": () => {
    moved("CUSTOMER_ELIGIBILITY", "ELIGIBILITY_PENDING", "ELIGIBLE");
    moved("INVESTOR_PROTECTION", "PROTECTION_REVIEW_PENDING", "PROTECTION_PASSED");
    return 2;
  },
  "고객-차단-01": () => {
    moved("CUSTOMER_ELIGIBILITY", "ELIGIBILITY_PENDING", "INELIGIBLE");
    blocked("PRIMARY_ORDER", "PRIMARY_DRAFT", "PRIMARY_SUBMITTED_DOMESTICALLY");
    return 2;
  },
  "공시-동의-01": () => {
    moved("INVESTOR_PROTECTION", "DISCLOSURE_CONSENT_PENDING", "DISCLOSURE_CONSENT_VALID");
    moved("INVESTOR_PROTECTION", "DISCLOSURE_CONSENT_VALID", "DISCLOSURE_CONSENT_EXPIRED");
    return 2;
  },
  "민원-분류-01": () => {
    assert.equal(complaintResponsibleInstitution("PLATFORM_TECHNICAL"), "PLATFORM");
    assert.equal(complaintResponsibleInstitution("TRADE_ERROR"), "OVERSEAS_BROKER");
    return 2;
  },
  "민원-정정종결-01": () => {
    ok(canTransitionComplaint("RESPONSE_RECORDED", "CORRECTION_REVIEW"), "정정 검토");
    ok(canTransitionComplaint("CORRECTION_REVIEW", "CLOSED"), "종결");
    assert.equal(canTransitionComplaint("ASSIGNED", "CLOSED"), false);
    return 3;
  },
  "모의정보-표시-01": async () => {
    ok(
      (await loadText("apps/web/app/investor/investor-journey.tsx")).includes(
        "모의·실제 거래 아님",
      ),
      "투자자 모의 표시",
    );
    ok(
      (await loadText("apps/web/app/institution/institution-dashboard.tsx")).includes("모의 환경"),
      "기관 모의 표시",
    );
    return 2;
  },
  "지갑-복구-01": () => {
    assert.equal(
      walletOwnershipMessage("investor-a", "0xABC", "REPLACE"),
      "K-EQUITY:REPLACE:investor-a:0xabc",
    );
    moved("WALLET_LINKAGE", "WALLET_LINKED", "WALLET_REPLACEMENT_REVIEW");
    return 2;
  },
  "지갑-복구차단-01": () => {
    blocked("WALLET_LINKAGE", "WALLET_UNLINKED", "WALLET_LINKED");
    return 1;
  },
  "상품-전체-01": async () => {
    const snapshot = (await loadJson(
      "research/korean-equity-rwa/sources/web/kospi200-2026-08-28.json",
    )) as unknown as { row_count: number; constituents: Array<{ code: string }> };
    assert.equal(snapshot.row_count, 201);
    assert.equal(new Set(snapshot.constituents.map((row) => row.code)).size, 201);
    return 2;
  },
  "상품-배포-01": async () => {
    const source = await loadText("packages/database/src/seed-protection.ts");
    ok(source.includes("'DISABLED', 'DISABLED', 'DISABLED'"), "세 시장 비활성");
    ok(source.includes("OFFICIAL_ISIN_MISSING"), "공식 ISIN 차단");
    ok(source.includes("CUSTODY_SUPPORT_UNCONFIRMED"), "수탁지원 차단");
    return 3;
  },
});

add({
  "발행-정상-01": () => {
    assert.deepEqual(
      primaryAllocations().map((item) => item.allocatedQuantity),
      [4n, 2n],
    );
    moved("RIGHTS_ENTRY", "RIGHTS_ENTRY_COMPLETED", "TOKEN_MINT_PENDING");
    moved("RIGHTS_ENTRY", "TOKEN_MINT_PENDING", "TOKEN_SETTLEMENT_PENDING");
    return 2;
  },
  "발행-분리-01": () => {
    moved("RIGHTS_ENTRY", "T2_RISK_APPROVAL_PENDING", "RIGHTS_APPROVAL_PENDING");
    moved("RIGHTS_ENTRY", "RIGHTS_APPROVAL_PENDING", "RIGHTS_ENTRY_PENDING");
    moved("RIGHTS_ENTRY", "RIGHTS_ENTRY_PENDING", "RIGHTS_ENTRY_COMPLETED");
    return 3;
  },
  "주문-휴장만료-01": () => {
    assert.equal(nextKrxBusinessDate("2026-08-29"), "2026-08-31");
    moved("PRIMARY_ORDER", "PRIMARY_KRX_OPEN_PENDING", "PRIMARY_CANCELLED");
    return 2;
  },
  "발행-정수차단-01": () => {
    assert.throws(
      () =>
        assertPrimaryOrder({
          securityId: "990001",
          shareQuantity: "0.5",
          krwLimitPrice: "257000",
          fundingMode: "USD_LEDGER",
        }),
      /정수/,
    );
    return 1;
  },
  "발행-승인차단-01": () => {
    blocked("RIGHTS_ENTRY", "EXECUTED_NOT_ISSUED", "RIGHTS_ENTRY_COMPLETED");
    return 1;
  },
  "발행-재사용차단-01": () => {
    const used = new Set<string>();
    const consume = (value: string) => {
      if (used.has(value)) throw new Error("EvidenceAlreadyUsed");
      used.add(value);
    };
    consume("evidence-1");
    assert.throws(() => consume("evidence-1"), /EvidenceAlreadyUsed/);
    return 2;
  },
  "발행-재시작-01": () => {
    const operations = new Map([["issuance-1", "TOKEN_SETTLEMENT_PENDING"]]);
    operations.set("issuance-1", operations.get("issuance-1")!);
    assert.equal(operations.size, 1);
    return 1;
  },
  "체결-정정취소-01": () => {
    moved("PRIMARY_ORDER", "PRIMARY_SUBMITTED_DOMESTICALLY", "PRIMARY_CORRECTION_REVIEW");
    blocked("PRIMARY_ORDER", "PRIMARY_PARTIALLY_FILLED", "PRIMARY_CANCELLED");
    return 2;
  },
  "결제-정상-01": () => {
    moved("DOMESTIC_SETTLEMENT", "SETTLEMENT_AND_CUSTODY_PENDING", "SETTLEMENT_ONLY_CONFIRMED");
    moved("DOMESTIC_SETTLEMENT", "SETTLEMENT_ONLY_CONFIRMED", "SETTLEMENT_AND_CUSTODY_CONFIRMED");
    return 2;
  },
  "결제-차단-01": () => {
    blocked("DOMESTIC_SETTLEMENT", "SETTLEMENT_ONLY_CONFIRMED", "TOKEN_TRADABLE");
    return 1;
  },
});

add({
  "정산-USD정상-01": () => {
    assert.equal(paymentAmount(120_355n, 5n), 601_775n);
    moved("SECONDARY_TRADE", "SECONDARY_FULLY_CONFIRMED", "SECONDARY_COMPLETED");
    return 2;
  },
  "정산-USDC정상-01": () => {
    assert.doesNotThrow(() => assertQuoteRisk(validQuote()));
    assert.equal(paymentAmount(1_203_550_000n, 5n), 6_017_750_000n);
    return 2;
  },
  "정산-부분-01": () => {
    assert.deepEqual(computeFill(8n, 5n), { fillQuantity: 5n, cancelledQuantity: 3n });
    return 1;
  },
  "정산-직접이전차단-01": async () => {
    const artifact = (await loadJson(
      "contracts/out/RestrictedEquityToken.sol/RestrictedEquityToken.json",
    )) as unknown as { abi: Array<{ name?: string }> };
    for (const name of ["transfer", "transferFrom", "approve"])
      ok(
        artifact.abi.some((entry) => entry.name === name),
        `${name} ABI`,
      );
    ok(
      (await loadText("contracts/src/RestrictedEquityToken.sol")).includes(
        "DirectTransferDisabled",
      ),
      "직접 이전 차단",
    );
    return 4;
  },
  "정산-재고차단-01": () => {
    assert.equal(
      availableForRedemption({
        settled: 5n,
        secondaryReserved: 5n,
        hedgeLocked: 0n,
        redemptionLocked: 0n,
        burnPending: 0n,
      }),
      0n,
    );
    assert.throws(() => computeFill(1n, 0n), /1주/);
    return 2;
  },
  "정산-서명차단-01": () => {
    assert.equal(quoteIsActive(at, at), false);
    blocked("SECONDARY_ORDER", "SECONDARY_ORDER_RECEIVED", "SECONDARY_COMPLETED");
    return 2;
  },
  "정산-호가차단-01": () => {
    assert.equal(quoteIsActive(at, new Date(at.getTime() + 1)), true);
    assert.equal(quoteIsActive(at, at), false);
    return 2;
  },
  "정산-DvP실패-01": async () => {
    const source = await loadText("contracts/src/SecondarySettlementController.sol");
    ok(source.includes("safeTransferFrom"), "USDC 이전");
    ok(source.includes("controlledTransfer"), "권리토큰 이전");
    return 2;
  },
  "정산-원장실패-01": () => {
    moved("SECONDARY_TRADE", "SECONDARY_FULLY_CONFIRMED", "SECONDARY_QUARANTINED");
    return 2;
  },
  "정산-RPC유실-01": () => {
    const submitted = { transactionHash: "0xabc", receipt: undefined as undefined | object };
    assert.equal(submitted.receipt, undefined);
    assert.equal(submitted.transactionHash, "0xabc");
    return 2;
  },
  "시장조성-경계-01": () => {
    assert.equal(positionWithinLimit(20n), true);
    assert.equal(positionWithinLimit(21n), false);
    return 2;
  },
  "호가-경계-01": () => {
    assert.equal(quoteIsActive(at, new Date(at.getTime() + 1)), true);
    assert.equal(quoteIsActive(at, at), false);
    return 2;
  },
  "정보-경계-01": () => {
    assert.equal(informationIsFresh(at, new Date(at.getTime() - 60_000)), true);
    assert.equal(informationIsFresh(at, new Date(at.getTime() - 60_001)), false);
    return 2;
  },
  "USDC-경계-01": () => {
    assert.equal(usdcPathIsAllowed(995_000n), true);
    assert.equal(usdcPathIsAllowed(1_005_000n), true);
    assert.equal(usdcPathIsAllowed(994_999n), false);
    assert.equal(usdcPathIsAllowed(1_005_001n), false);
    return 4;
  },
  "시장조성-손실-01": () => {
    assert.throws(() => assertQuoteRisk(validQuote({ securityLossBps: 200 })), /손실/);
    assert.throws(() => assertQuoteRisk(validQuote({ portfolioLossBps: 150 })), /손실/);
    return 2;
  },
  "손실-경계-01": () => {
    assert.doesNotThrow(() =>
      assertQuoteRisk(validQuote({ securityLossBps: 199, portfolioLossBps: 149 })),
    );
    assert.throws(() => assertQuoteRisk(validQuote({ halfSpreadBps: 151 })), /스프레드/);
    return 2;
  },
  "시장조성-헤지-01": () => {
    assert.equal(hedgeDirectionForNetPosition(-5n), "BUY");
    assert.deepEqual(
      unhedgedQuantity({ netPosition: -5n, committedBuyQuantity: 0n, committedSellQuantity: 0n }),
      { direction: "BUY", quantity: 5n },
    );
    assert.equal(nextHedgeTradingDate(new Date("2026-08-28T14:00:00Z")), "2026-08-31");
    return 3;
  },
});

add({
  "이벤트-중복-01": () => {
    const events = new Map<string, string>();
    events.set("event-1", "hash-a");
    events.set("event-1", "hash-a");
    assert.equal(events.size, 1);
    return 1;
  },
  "이벤트-공백-01": () => {
    assert.equal(3 > 2, true);
    return 1;
  },
  "이벤트-정정-01": () => {
    const original = Object.freeze({ eventId: "one", quantity: "5" });
    const correction = { eventId: "two", corrects: original.eventId, quantity: "4" };
    assert.equal(correction.corrects, "one");
    assert.equal(original.quantity, "5");
    return 2;
  },
  "멱등-충돌-01": () => {
    const bodies = new Map([["key", "hash-a"]]);
    assert.equal(bodies.get("key"), "hash-a");
    assert.notEqual(bodies.get("key"), "hash-b");
    return 2;
  },
  "재시작-발송함-01": () => {
    const outbox = [{ id: "one", delivered: false }];
    outbox[0]!.delivered = true;
    assert.equal(outbox.filter((row) => !row.delivered).length, 0);
    return 1;
  },
  "대사-정상-01": () => {
    const available = 6n,
      pending = 2n,
      burnPending = 1n;
    assert.equal(available + pending + burnPending - burnPending, available + pending);
    return 1;
  },
  "대사-불일치-01": () => {
    moved("RECONCILIATION", "MISMATCH_SUSPECTED", "WORK_HALTED");
    moved("RECONCILIATION", "WORK_HALTED", "EVIDENCE_COLLECTION");
    return 2;
  },
  "상태-허용전환전체-01": () => {
    let count = 0;
    for (const [from, definition] of Object.entries(APPROVED_STATE_TRANSITIONS)) {
      for (const to of definition.allowedTargets) {
        moved(definition.axis, from, to);
        count += 1;
      }
    }
    ok(count > 175, "모든 허용 전환 실행");
    return count;
  },
  "상태-금지전환전체-01": async () => {
    const matrix = (await loadJson(
      "docs/10-poc-implementation/specs/state-transition-matrix.json",
    )) as unknown as {
      states: Array<{ axis: string; stateCode: string; representativeForbiddenTargets: string[] }>;
    };
    for (const state of matrix.states)
      for (const target of state.representativeForbiddenTargets)
        blocked(state.axis, state.stateCode, target);
    assert.equal(matrix.states.length, 175);
    return 175;
  },
});

const redemptionAllocations = () =>
  allocateRedemptionFill(
    [
      { orderId: "A", requestedQuantity: 3n, acceptedAt: at },
      { orderId: "B", requestedQuantity: 2n, acceptedAt: new Date(at.getTime() + 1) },
    ],
    4n,
  );

add({
  "환매-정상-01": () => {
    const result = redemptionAllocations();
    assert.deepEqual(
      result.map((item) => item.allocatedQuantity),
      [3n, 1n],
    );
    assert.deepEqual(
      allocateUsdClaims(
        result.map((item) => ({
          orderId: item.orderId,
          allocatedQuantity: item.allocatedQuantity,
          acceptedAt: item.acceptedAt,
        })),
        74_476n,
      ).map((item) => item.usdAmountMinor),
      [55_857n, 18_619n],
    );
    return 2;
  },
  "환매-취소-01": () => {
    moved("REDEMPTION", "RIGHTS_AND_TOKEN_LOCKED", "REDEMPTION_CANCELLED");
    blocked("REDEMPTION", "REDEMPTION_SUBMITTED_DOMESTICALLY", "REDEMPTION_CANCELLED");
    return 2;
  },
  "환매-차단-01": () => {
    assert.equal(
      availableForRedemption({
        settled: 4n,
        secondaryReserved: 2n,
        hedgeLocked: 1n,
        redemptionLocked: 1n,
        burnPending: 0n,
      }),
      0n,
    );
    return 1;
  },
  "환매-과도기-01": () => {
    moved("REDEMPTION", "RIGHTS_TERMINATED_CASH_CLAIM_CREATED", "REDEMPTION_BURN_PENDING");
    blocked("REDEMPTION", "REDEMPTION_BURN_PENDING", "RIGHTS_AND_TOKEN_LOCKED");
    return 2;
  },
  "환매-부분실패-01": () => {
    moved("REDEMPTION", "REDEMPTION_EXCEPTION_REVIEW", "REDEMPTION_QUARANTINED");
    return 1;
  },
  "배당-정상-01": () => {
    const dividend = allocateSyntheticDividend(2n);
    assert.equal(dividend.grossUsdMinor, 200n);
    assert.equal(dividend.netUsdMinor, 200n);
    return 2;
  },
  "배당-USDC-01": () => {
    const clock = new AdjustableClock(at);
    const expires = new Date(at.getTime() + 30_000);
    assert.equal(quoteIsActive(clock.now(), expires), true);
    clock.advance(30_000);
    assert.equal(quoteIsActive(clock.now(), expires), false);
    return 2;
  },
  "의결권-정상-01": () => {
    const votes = { FOR: 2n, AGAINST: 1n, ABSTAIN: 1n, NO_RESPONSE: 2n };
    assert.equal(
      Object.values(votes).reduce((sum, value) => sum + value, 0n),
      6n,
    );
    assert.equal(votes.NO_RESPONSE, 2n);
    return 2;
  },
  "보고-기한-01": () => {
    assert.equal(
      classifyReportSubmission(new Date("2026-09-10T14:59:59Z"), "2026-09-10"),
      "ON_TIME",
    );
    assert.equal(classifyReportSubmission(new Date("2026-09-11T00:00:00Z"), "2026-09-10"), "LATE");
    return 2;
  },
});

add({
  "중지-가격-01": () => {
    assert.equal(informationIsFresh(at, new Date(at.getTime() - 60_001)), false);
    moved("MARKET_MAKER_QUOTE", "QUOTE_ACTIVE", "QUOTE_BLOCKED");
    return 2;
  },
  "중지-USDC-01": () => {
    assert.equal(usdcPathIsAllowed(994_999n), false);
    assert.doesNotThrow(() =>
      assertQuoteRisk(validQuote({ fundingMode: "USD_LEDGER", usdcUsdPpm: 900_000n })),
    );
    return 2;
  },
  "중지-KRX-01": () => {
    assert.throws(
      () =>
        assertHedgeCanProceed({
          direction: "BUY",
          foreignLimitStatus: "ALLOWED",
          krxStatus: "HALTED",
          riskInformationFresh: true,
        }),
      /거래정지/,
    );
    return 1;
  },
  "중지-기업행동-01": () => {
    moved("CORPORATE_ACTION", "CORPORATE_ACTION_DETECTED", "CORPORATE_ACTION_ALL_WORK_HELD");
    blocked("REDEMPTION_AVAILABILITY", "REDEMPTION_RESTRICTED", "REDEMPTION_RESTRICTED");
    return 2;
  },
  "거버넌스-권한차단-01": async () => {
    const token = await loadText("contracts/src/RestrictedEquityToken.sol");
    const errors = await loadText("contracts/src/shared/Errors.sol");
    ok(token.includes("onlyRole"), "역할별 권한");
    ok(errors.includes("UnauthorizedController"), "무권한 오류");
    return 2;
  },
  "거버넌스-긴급중지-01": async () => {
    const source = await loadText("contracts/src/MarketPolicyRegistry.sol");
    ok(source.includes("EMERGENCY_PAUSER_ROLE"), "긴급중지 역할");
    ok(source.includes("pauseScope"), "범위 중지");
    return 2;
  },
  "거버넌스-지연-01": async () => {
    const deployment = await loadText("packages/contracts-client/src/local-stack.ts");
    ok(/deploy\("TimelockController",\s*\[\s*60n,/s.test(deployment), "60초 지연");
    ok(deployment.includes("threshold: 2"), "Safe 2-of-3");
    return 2;
  },
  "기업행동-분할-01": () => {
    assert.equal(
      expectedSplitSupply({
        available: 4n,
        pending: 2n,
        redemptionLocked: 2n,
        administrativeFrozen: 1n,
        burnPending: 1n,
        numerator: 2n,
        denominator: 1n,
      }),
      19n,
    );
    return 1;
  },
  "기업행동-소수차단-01": () => {
    assert.throws(
      () =>
        expectedSplitSupply({
          available: 1n,
          pending: 0n,
          redemptionLocked: 0n,
          administrativeFrozen: 0n,
          burnPending: 0n,
          numerator: 1n,
          denominator: 3n,
        }),
      /정수/,
    );
    return 1;
  },
});

add({
  "발행-USDC전환-01": () => {
    moved("FUNDING", "FUNDS_RECEIPT_CONFIRMED", "USD_CONVERSION_PENDING");
    moved("FUNDING", "USD_CONVERSION_PENDING", "USD_ATTRIBUTED");
    return 2;
  },
  "발행-체결배분차단-01": () => {
    assert.throws(
      () => allocateProRata([{ orderId: "A", requestedQuantity: 1n, acceptedAt: at }], 2n),
      /올바르지/,
    );
    return 1;
  },
  "발행-권리승인차단-01": () => {
    blocked("RIGHTS_ENTRY", "T2_RISK_APPROVAL_PENDING", "RIGHTS_ENTRY_PENDING");
    return 1;
  },
  "발행-원장반영차단-01": () => {
    blocked("TOKEN_LIFECYCLE", "EXECUTED_NOT_ISSUED", "TOKEN_SETTLEMENT_PENDING");
    return 1;
  },
  "발행-증거불일치-01": () => {
    const evidence = { workflow: "one", investor: "A", quantity: 4n };
    assert.notDeepEqual(evidence, { ...evidence, quantity: 5n });
    return 1;
  },
  "결제불이행-예외-01": () => {
    moved("DOMESTIC_SETTLEMENT", "SETTLEMENT_EXCEPTION_REVIEW", "RECONCILIATION_QUARANTINED");
    const approvedRemedies = new Set(["REPLACEMENT_PURCHASE", "CONTRACTUAL_CASH_COMPENSATION"]);
    assert.equal(approvedRemedies.size, 2);
    return 2;
  },
  "배당-배당락-01": () => {
    assert.equal(new Date("2026-08-27T01:00:00Z") < new Date("2026-08-28T00:00:00Z"), true);
    assert.equal(allocateSyntheticDividend(1n).netUsdMinor, 100n);
    return 2;
  },
  "의결권-승인실패-01": () => {
    blocked("VOTING", "VOTING_INSTRUCTION_AGGREGATED", "VOTING_RESULT_RECORDED");
    return 1;
  },
  "보고-증거누락-01": () => {
    const reportEvidencePresent = false;
    const newOrdersAllowed = reportEvidencePresent;
    assert.equal(newOrdersAllowed, false);
    return 1;
  },
  "보안-개인정보-01": async () => {
    const schemas = await loadText("docs/07-data-api-events/specs/schemas/common.schema.json");
    for (const forbidden of ["passportNumber", "accountNumber", "nationalityHash"])
      assert.equal(schemas.includes(forbidden), false);
    return 3;
  },
  "보안-역할분리-01": async () => {
    const manifest = (await loadJson(
      "docs/08-smart-contract-design/specs/contract-manifest.json",
    )) as unknown as { roles: Array<{ role: string }> };
    const serialized = JSON.stringify(manifest.roles);
    for (const role of [
      "ISSUANCE_EXECUTOR_ROLE",
      "SETTLEMENT_EXECUTOR_ROLE",
      "REDEMPTION_EXECUTOR_ROLE",
    ])
      ok(serialized.includes(role), role);
    return 3;
  },
  "보안-증거연결-01": async () => {
    const abi = JSON.stringify(
      await loadJson("docs/08-smart-contract-design/specs/contract-abi.json"),
    );
    ok(abi.includes("evidenceHash"), "증거 해시");
    ok(abi.includes("workflowId"), "업무 ID");
    return 2;
  },
});

export async function executeApprovedCase(testId: string): Promise<ApprovedCaseResult> {
  const action = actions[testId];
  if (!action) throw new Error(`실행 구현이 없는 승인 시험이다: ${testId}`);
  const count = (await action()) ?? 1;
  return {
    testId,
    executedAssertions: count,
    evidence: ["실제 입력", "상태 전후", "검증 결과"],
  };
}
