import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { format, resolveConfig } from "prettier";

const root = resolve(import.meta.dirname, "..");
const catalog = JSON.parse(
  await readFile(resolve(root, "docs/09-test-design/specs/test-catalog.json"), "utf8"),
);
const traceability = JSON.parse(
  await readFile(resolve(root, "docs/09-test-design/specs/traceability.json"), "utf8"),
);

const groupFiles = {
  고객상품지갑: "tests/acceptance/customer-product-wallet.acceptance.test.ts",
  발행결제: "tests/acceptance/issuance-settlement.acceptance.test.ts",
  이차정산시장조성: "tests/acceptance/secondary-market-maker.acceptance.test.ts",
  이벤트장애대사: "tests/acceptance/event-recovery-reconciliation.acceptance.test.ts",
  환매권리업무: "tests/acceptance/redemption-rights.acceptance.test.ts",
  중지거버넌스기업행동: "tests/acceptance/halts-governance-corporate-actions.acceptance.test.ts",
  보안감사: "tests/acceptance/security-audit.acceptance.test.ts",
};

const supportingExecutables = {
  고객상품지갑: [
    ["Vitest", "packages/domain/test/protection.test.ts", "민원을 승인된 순서로만 전환한다"],
    ["PostgreSQL·API", "packages/database/test/protection.integration.test.ts", "기준정보를 반복 적재해도 201개 후보와 대표 6종목만 유지한다"],
    ["PostgreSQL·API", "apps/api/src/protection-routes.integration.test.ts", "공시 동의는 202로 접수하고 동일 멱등키의 다른 본문은 거절한다"],
    ["Playwright", "tests/browser/foundation.spec.ts", "위험공시, 전용 지갑과 민원을 비동기로 접수하고 종결한다"],
  ],
  발행결제: [
    ["Vitest", "packages/domain/test/primary-issuance.test.ts", "5주와 3주 주문의 6주 체결을 4주와 2주로 결정적으로 배분한다"],
    ["PostgreSQL·API", "packages/database/test/primary.integration.test.ts", "USD 5주와 USDC 3주를 취합해 6주 체결을 4주·2주로 배분하고 두 확인 뒤 전환한다"],
    ["Foundry·Anvil", "contracts/test/IssuanceController.t.sol", "test_FourIndependentFactsAreRequiredBeforePendingMintAndBothSettlementFactsBeforeRelease"],
    ["Playwright", "tests/browser/foundation.spec.ts", "로컬 합성 상품을 4주·2주로 배분하고 두 결제 확인 뒤 거래 가능으로 전환한다"],
  ],
  이차정산시장조성: [
    ["Vitest", "packages/domain/test/secondary-trading.test.ts", "8주 주문을 잔여호가 5주로 한 번만 부분체결한다"],
    ["PostgreSQL·API", "packages/database/test/secondary.integration.test.ts", "8주 주문을 5주만 체결하고 권리·자금·재고를 함께 확정한다"],
    ["Foundry·Anvil", "contracts/test/SecondarySettlementController.t.sol", "test_UsdcDvpPartiallyFillsOnceAndPreservesPendingInventory"],
    ["Playwright", "tests/browser/foundation.spec.ts", "지정 시장조성자 호가에서 USDC 8주 주문을 5주만 체결하고 3주를 해제한다"],
  ],
  이벤트장애대사: [
    ["PostgreSQL·API", "packages/database/test/outbox.integration.test.ts", "한 작업자를 위한 메시지를 중복 없이 점유한다"],
    ["PostgreSQL·API", "packages/database/test/secondary.integration.test.ts", "체인 성공 뒤 권리 원장 실패를 격리하고 같은 거래를 재전송하지 않고 종결한다"],
    ["Playwright", "tests/browser/foundation.spec.ts", "투자자와 기관 화면은 서로 다른 모의 업무공간으로 이동한다"],
  ],
  환매권리업무: [
    ["Vitest", "packages/domain/test/redemption.test.ts", "A 3주·B 2주의 4주 체결을 A 3주·B 1주로 배분하고 USD 청구도 맞춘다"],
    ["PostgreSQL·API", "packages/database/test/redemption.integration.test.ts", "A 3주·B 2주를 4주 부분체결하고 지급청구·소각·USD 지급을 완결한다"],
    ["Foundry·Anvil", "contracts/test/RedemptionController.t.sol", "test_PartialExecutionReleasesOnlyUnfilledQuantityAndRequiresSettlement"],
    ["Playwright", "tests/browser/foundation.spec.ts", "기존 A 4주·B 2주 권리를 4주 부분환매하고 USD 지급과 소각을 완결한다"],
  ],
  중지거버넌스기업행동: [
    ["Vitest", "packages/domain/test/rights-and-controls.test.ts", "2대1 분할에서 소각 대기 수량을 조정하지 않는다"],
    ["Foundry·Anvil", "contracts/test/GovernanceFoundation.t.sol", "test_SafeAndTimelockEnforceTwoSignaturesAndSixtySecondDelay"],
    ["Foundry·Anvil", "contracts/test/RecoveryAndCorporateActionController.t.sol", "test_NonIntegralPlanRevertsWithoutPartialMutation"],
    ["Playwright", "tests/browser/foundation.spec.ts", "배당·의결권·보고와 기업행동 통제를 시연한다"],
  ],
  보안감사: [
    ["저장소 검증기", "scripts/check-no-secrets.sh", "secret hygiene check passed"],
    ["Foundry·Anvil", "contracts/test/IntentVerifier.t.sol", "test_ExpiredAndWrongPolicySignaturesAreRejected"],
    ["Foundry·Anvil", "contracts/test/RestrictedTokenFoundation.t.sol", "test_UnauthorizedWalletCannotMintTransferOrBurn"],
    ["PostgreSQL·API", "apps/api/src/rights-routes.integration.test.ts", "월별 보고 증거 누락은 신규 주문 중지를 만들고 제출 증거를 보존한다"],
  ],
};

function reverseLinks(testId) {
  const selects = (key, id) =>
    (traceability[key] ?? [])
      .filter((entry) => entry.tests?.includes(testId))
      .map((entry) => entry[id]);
  const contractSelects = (key, name) =>
    (traceability[key] ?? [])
      .filter((entry) => entry.tests?.includes(testId))
      .map((entry) => `${entry.contract ?? "governance"}.${entry[name]}`);
  return {
    requirementIds: (traceability.requirements ?? [])
      .filter((entry) =>
        [...(entry.positiveTests ?? []), ...(entry.negativeTests ?? [])].includes(testId),
      )
      .map((entry) => entry.requirementId),
    stateCodes: (traceability.states ?? [])
      .filter((entry) =>
        [
          ...(entry.tests ?? []),
          ...(entry.allowedTransitionTests ?? []),
          ...(entry.forbiddenTransitionTests ?? []),
        ].includes(testId),
      )
      .map((entry) => entry.stateCode),
    openApiOperations: selects("openApiOperations", "operationId"),
    asyncApiMessages: selects("asyncApiMessages", "messageName"),
    contractFunctions: [
      ...contractSelects("contractFunctions", "function"),
      ...contractSelects("administrativeContractFunctions", "function"),
    ],
    contractEvents: [
      ...contractSelects("contractEvents", "event"),
      ...contractSelects("administrativeContractEvents", "event"),
    ],
    contractErrors: [
      ...contractSelects("contractErrors", "error"),
      ...contractSelects("administrativeContractErrors", "error"),
    ],
    roles: selects("roles", "role"),
    invariants: selects("invariants", "invariant"),
  };
}

const cases = catalog.groups.flatMap((group) =>
  group.cases.map((testCase) => ({
    testId: testCase.testId,
    groupId: group.groupId,
    automated: testCase.automated,
    executionProfile: testCase.profile,
    primaryExecutable: testCase.automated
      ? { runner: "Vitest", file: groupFiles[group.groupId], testName: testCase.testId }
      : null,
    supportingExecutables: testCase.automated
      ? (supportingExecutables[group.groupId] ?? []).map(([runner, file, testName]) => ({
          runner,
          file,
          testName,
        }))
      : [],
    expectedResult: {
      startStates: testCase.startStates,
      expectedStates: testCase.expectedStates,
      forbiddenStates: testCase.forbiddenStates,
      expectedQuantities: testCase.expectedQuantities,
      expectedAmounts: testCase.expectedAmounts,
      expectedErrors: testCase.expectedErrors,
      recoveryOrQuarantine: testCase.recoveryOrQuarantine,
      resumeConditions: testCase.resumeConditions,
    },
    traceability: reverseLinks(testCase.testId),
    evidence: testCase.evidence,
    status: testCase.automated ? "LOCAL_AUTOMATED" : "BLOCKED_OFFICIAL_ISIN",
  })),
);

const output = await format(
  JSON.stringify({
    $schema: "./implementation-test-map.schema.json",
    schemaVersion: "2.0.0",
    sourceCatalog: "../../09-test-design/specs/test-catalog.json",
    sourceTraceability: "../../09-test-design/specs/traceability.json",
    totals: { all: cases.length, localAutomated: 76, fujiManual: 3 },
    cases,
  }),
  {
    ...(await resolveConfig(
      resolve(root, "docs/10-poc-implementation/specs/implementation-test-map.json"),
    )),
    parser: "json",
  },
);
await writeFile(
  resolve(root, "docs/10-poc-implementation/specs/implementation-test-map.json"),
  output,
  "utf8",
);
