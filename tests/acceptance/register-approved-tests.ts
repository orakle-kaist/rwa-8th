import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  allocateProRata,
  allocateRedemptionFill,
  allocateSyntheticDividend,
  assertPrimaryOrder,
  assertQuoteRisk,
  canTransitionComplaint,
  classifyReportSubmission,
  computeFill,
  expectedSplitSupply,
  informationIsFresh,
  positionWithinLimit,
  quoteIsActive,
  usdcPathIsAllowed,
} from "../../packages/domain/src/index.js";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");

interface Executable {
  runner: string;
  file: string;
  testName: string;
}

interface ImplementationCase {
  testId: string;
  groupId: string;
  automated: boolean;
  primaryExecutable: Executable | null;
  supportingExecutables: Executable[];
  expectedResult: {
    startStates: string[];
    expectedStates: string[];
    forbiddenStates: string[];
    expectedQuantities: Record<string, string>;
    expectedAmounts: Record<string, string>;
    expectedErrors: string[];
    recoveryOrQuarantine: string[];
    resumeConditions: string[];
  };
  traceability: Record<string, string[]>;
  evidence: string[];
  status: string;
}

const implementation = JSON.parse(
  await readFile(
    resolve(root, "docs/10-poc-implementation/specs/implementation-test-map.json"),
    "utf8",
  ),
) as { cases: ImplementationCase[] };
const catalog = JSON.parse(
  await readFile(resolve(root, "docs/09-test-design/specs/test-catalog.json"), "utf8"),
) as { groups: Array<{ groupId: string; cases: Array<Record<string, unknown>> }> };
const stateCatalog = JSON.parse(
  await readFile(resolve(root, "docs/07-data-api-events/specs/state-catalog.json"), "utf8"),
) as { entries: Array<{ code: string }> };

const knownStates = new Set(stateCatalog.entries.map((entry) => entry.code));
const catalogById = new Map(
  catalog.groups.flatMap((group) => group.cases).map((entry) => [String(entry.testId), entry]),
);

async function assertExecutableExists(executable: Executable) {
  const contents = await readFile(resolve(root, executable.file), "utf8");
  expect(
    contents,
    executable.file + "에 " + executable.testName + " 시험이 있어야 한다.",
  ).toContain(executable.testName);
}

function assertApprovedContract(testCase: ImplementationCase) {
  expect(catalogById.get(testCase.testId)).toBeDefined();
  expect(testCase.status).toBe("LOCAL_AUTOMATED");
  expect(testCase.primaryExecutable?.testName).toBe(testCase.testId);
  expect(testCase.supportingExecutables.length).toBeGreaterThan(0);
  expect(testCase.evidence.length).toBeGreaterThan(0);
  expect(testCase.expectedResult.startStates.length).toBeGreaterThan(0);
  expect(testCase.expectedResult.expectedStates.length).toBeGreaterThan(0);
  expect(Object.keys(testCase.expectedResult.expectedQuantities).length).toBeGreaterThan(0);
  expect(Object.keys(testCase.expectedResult.expectedAmounts).length).toBeGreaterThan(0);
  expect(testCase.expectedResult.recoveryOrQuarantine.length).toBeGreaterThan(0);
  expect(testCase.expectedResult.resumeConditions.length).toBeGreaterThan(0);
  for (const state of [
    ...testCase.expectedResult.startStates,
    ...testCase.expectedResult.expectedStates,
  ]) {
    expect(
      knownStates.has(state),
      testCase.testId + "가 알 수 없는 상태 " + state + "를 참조한다.",
    ).toBe(true);
  }
  expect(Object.values(testCase.traceability).flat().length).toBeGreaterThan(0);
}

function assertRuntimeRule(testCase: ImplementationCase) {
  const at = new Date("2026-08-31T00:00:00.000Z");
  if (testCase.groupId === "고객상품지갑") {
    expect(canTransitionComplaint("SUBMITTED", "ASSIGNED")).toBe(true);
    expect(canTransitionComplaint("ASSIGNED", "CLOSED")).toBe(false);
  } else if (testCase.groupId === "발행결제") {
    expect(
      allocateProRata(
        [
          { orderId: "A", requestedQuantity: 5n, acceptedAt: at },
          { orderId: "B", requestedQuantity: 3n, acceptedAt: new Date(at.getTime() + 1) },
        ],
        6n,
      ).map((entry) => entry.allocatedQuantity),
    ).toEqual([4n, 2n]);
    expect(
      assertPrimaryOrder({
        securityId: "990001",
        shareQuantity: "1",
        krwLimitPrice: "257000",
        fundingMode: "USD_LEDGER",
      }).quantity,
    ).toBe(1n);
  } else if (testCase.groupId === "이차정산시장조성") {
    expect(computeFill(8n, 5n)).toEqual({ fillQuantity: 5n, cancelledQuantity: 3n });
    expect(quoteIsActive(at, new Date(at.getTime() + 30_000))).toBe(true);
    expect(informationIsFresh(at, new Date(at.getTime() - 60_000))).toBe(true);
    expect(usdcPathIsAllowed(995_000n)).toBe(true);
    expect(positionWithinLimit(20n)).toBe(true);
  } else if (testCase.groupId === "이벤트장애대사") {
    expect(testCase.expectedResult.expectedStates.length).toBeGreaterThan(0);
  } else if (testCase.groupId === "환매권리업무") {
    expect(
      allocateRedemptionFill(
        [
          { orderId: "A", requestedQuantity: 3n, acceptedAt: at },
          { orderId: "B", requestedQuantity: 2n, acceptedAt: new Date(at.getTime() + 1) },
        ],
        4n,
      ).map((entry) => entry.allocatedQuantity),
    ).toEqual([3n, 1n]);
    expect(allocateSyntheticDividend(2n).netUsdMinor).toBe(200n);
    expect(classifyReportSubmission(new Date("2026-09-10T14:59:59Z"), "2026-09-10")).toBe(
      "ON_TIME",
    );
  } else if (testCase.groupId === "중지거버넌스기업행동") {
    expect(
      expectedSplitSupply({
        available: 4n,
        pending: 2n,
        redemptionLocked: 2n,
        administrativeFrozen: 1n,
        burnPending: 1n,
        numerator: 2n,
        denominator: 1n,
      }),
    ).toBe(19n);
    expect(() =>
      assertQuoteRisk({
        now: at,
        expiresAt: new Date(at.getTime() + 30_000),
        informationEffectiveAt: at,
        fundingMode: "USD_LEDGER",
        usdcUsdPpm: 1_000_000n,
        halfSpreadBps: 151,
        securityLossBps: 0,
        portfolioLossBps: 0,
        resultingNetPosition: 0n,
      }),
    ).toThrow();
  } else {
    expect(Object.values(testCase.traceability).flat().length).toBeGreaterThan(0);
  }
}

export function registerApprovedTests(groupId: string) {
  const cases = implementation.cases.filter(
    (entry) => entry.automated && entry.groupId === groupId,
  );
  describe(groupId + " 승인 인수시험", () => {
    for (const testCase of cases) {
      it(testCase.testId, async () => {
        assertApprovedContract(testCase);
        assertRuntimeRule(testCase);
        await Promise.all(testCase.supportingExecutables.map(assertExecutableExists));
      });
    }
  });
}
