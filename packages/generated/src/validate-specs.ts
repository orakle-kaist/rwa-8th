import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { parse } from "yaml";

const repositoryRoot = resolve(import.meta.dirname, "../../..");

async function readJson(relativePath: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(resolve(repositoryRoot, relativePath), "utf8")) as Record<
    string,
    unknown
  >;
}

async function readYaml(relativePath: string): Promise<Record<string, unknown>> {
  return parse(await readFile(resolve(repositoryRoot, relativePath), "utf8")) as Record<
    string,
    unknown
  >;
}

function fail(message: string): never {
  throw new Error(`승인 명세 검증 실패: ${message}`);
}

function operationIds(document: Record<string, unknown>): string[] {
  const paths = document.paths as Record<string, Record<string, { operationId?: string }>>;
  return Object.values(paths).flatMap((pathItem) =>
    Object.values(pathItem).flatMap((operation) =>
      operation.operationId ? [operation.operationId] : [],
    ),
  );
}

const [
  platformApi,
  adapterApi,
  asyncApi,
  manifest,
  contractAbi,
  governanceAbi,
  testCatalog,
  traceability,
  implementationTestMap,
  stateTransitionMatrix,
] = await Promise.all([
  readYaml("docs/07-data-api-events/specs/openapi.platform.yaml"),
  readYaml("docs/07-data-api-events/specs/openapi.adapters.yaml"),
  readYaml("docs/07-data-api-events/specs/asyncapi.yaml"),
  readJson("docs/08-smart-contract-design/specs/contract-manifest.json"),
  readJson("docs/08-smart-contract-design/specs/contract-abi.json"),
  readJson("docs/08-smart-contract-design/specs/governance-abi.json"),
  readJson("docs/09-test-design/specs/test-catalog.json"),
  readJson("docs/09-test-design/specs/traceability.json"),
  readJson("docs/10-poc-implementation/specs/implementation-test-map.json"),
  readJson("docs/10-poc-implementation/specs/state-transition-matrix.json"),
]);

const operations = [...operationIds(platformApi), ...operationIds(adapterApi)];
if (operations.length !== 48 || new Set(operations).size !== 48) {
  fail(`OpenAPI 동작은 서로 다른 48개여야 하지만 ${operations.length}개다.`);
}

const messages = Object.values(
  ((asyncApi.components as Record<string, unknown>).messages ?? {}) as Record<string, unknown>,
);
if (messages.length !== 8) {
  fail(`AsyncAPI 메시지는 8개여야 하지만 ${messages.length}개다.`);
}

const contracts = manifest.contracts as Array<{
  functions: string[];
  events: string[];
}>;
const functionCount = contracts.reduce((total, contract) => total + contract.functions.length, 0);
const eventCount = contracts.reduce((total, contract) => total + contract.events.length, 0);
if (contracts.length !== 10 || functionCount !== 71 || eventCount !== 44) {
  fail("계약 수, 함수 수 또는 이벤트 수가 승인된 10·71·44와 다르다.");
}

const errors = contractAbi.errors as unknown[];
const roles = manifest.roles as unknown[];
const invariants = manifest.requiredInvariants as unknown[];
if (errors.length !== 17 || roles.length !== 20 || invariants.length !== 9) {
  fail("오류, 역할 또는 불변식 수가 승인된 17·20·9와 다르다.");
}

const accessControl = governanceAbi.standardAccessControl as {
  functions: unknown[];
  events: unknown[];
  errors: unknown[];
};
const governanceExtensions = governanceAbi.contractExtensions as Array<{
  functions: unknown[];
  events: unknown[];
  errors: unknown[];
}>;
const extensionFunctionCount = governanceExtensions.reduce(
  (total, extension) => total + extension.functions.length,
  0,
);
if (
  governanceAbi.status !== "APPROVED" ||
  (governanceAbi.accessControlContracts as unknown[]).length !== 8 ||
  accessControl.functions.length !== 7 ||
  accessControl.events.length !== 3 ||
  accessControl.errors.length !== 2 ||
  extensionFunctionCount !== 7
) {
  fail("관리 ABI가 승인된 역할관리 및 기반 계약 조회 범위와 다르다.");
}

const groups = testCatalog.groups as Array<{ cases: unknown[] }>;
const testCount = groups.reduce((total, group) => total + group.cases.length, 0);
if (testCatalog.status !== "APPROVED" || testCount !== 79) {
  fail(`승인된 필수 시험은 79개여야 하지만 ${testCount}개다.`);
}

const approvedTestIds = new Set(
  groups.flatMap((group) =>
    (group.cases as Array<{ testId: string }>).map((testCase) => testCase.testId),
  ),
);
const implementationCases = implementationTestMap.cases as Array<{
  testId: string;
  automated: boolean;
  primaryExecutable: { runner: string; file: string; testName: string } | null;
  supportingExecutables: Array<{ runner: string; file: string; testName: string }>;
  expectedResult: Record<string, unknown>;
  traceability: Record<string, string[]>;
  status: string;
}>;
const implementationIds = new Set(implementationCases.map((testCase) => testCase.testId));
const localCases = implementationCases.filter((testCase) => testCase.automated);
const fujiCases = implementationCases.filter((testCase) => !testCase.automated);
if (
  implementationCases.length !== 79 ||
  implementationIds.size !== 79 ||
  localCases.length !== 76 ||
  fujiCases.length !== 3 ||
  [...approvedTestIds].some((testId) => !implementationIds.has(testId))
) {
  fail("79개 승인 시험은 76개 로컬 자동시험과 3개 Fuji 사람시험으로 일대일 연결돼야 한다.");
}
if (
  localCases.some(
    (testCase) =>
      testCase.primaryExecutable?.testName !== testCase.testId ||
      !testCase.primaryExecutable.file.startsWith("tests/acceptance/") ||
      testCase.supportingExecutables.length === 0 ||
      Object.values(testCase.expectedResult).some((value) => value === null) ||
      testCase.status !== "LOCAL_AUTOMATED",
  ) ||
  fujiCases.some(
    (testCase) =>
      testCase.primaryExecutable !== null || testCase.status !== "BLOCKED_OFFICIAL_ISIN",
  )
) {
  fail("로컬 시험 실행위치 또는 Fuji 차단상태가 승인된 구현 경계와 다르다.");
}

const primaryKeys = localCases.map(
  (testCase) =>
    testCase.primaryExecutable!.runner +
    ":" +
    testCase.primaryExecutable!.file +
    ":" +
    testCase.primaryExecutable!.testName,
);
if (new Set(primaryKeys).size !== 76) {
  fail("76개 로컬 시험은 서로 다른 주 실행시험 결과를 가져야 한다.");
}

for (const testCase of localCases) {
  const primaryContents = await readFile(
    resolve(repositoryRoot, testCase.primaryExecutable!.file),
    "utf8",
  );
  if (!primaryContents.includes("registerApprovedTests")) {
    fail(testCase.testId + "의 주 실행파일이 승인 시험 등록기를 사용하지 않는다.");
  }
  for (const executable of testCase.supportingExecutables) {
    const contents = await readFile(resolve(repositoryRoot, executable.file), "utf8");
    if (!contents.includes(executable.testName)) {
      fail(
        testCase.testId + "의 보조 시험이 없다: " + executable.file + "::" + executable.testName,
      );
    }
  }
}

const executableCaseSource = await readFile(
  resolve(repositoryRoot, "tests/acceptance/run-approved-case.ts"),
  "utf8",
);
if (
  localCases.some((testCase) => !executableCaseSource.includes(`"${testCase.testId}"`)) ||
  executableCaseSource.includes("assertRuntimeRule") ||
  executableCaseSource.includes("assertExecutableExists")
) {
  fail("76개 로컬 시험은 그룹 공통 메타데이터 검사가 아니라 시험별 실행 동작을 가져야 한다.");
}

if (
  traceability.status !== "APPROVED" ||
  (traceability.requirements as unknown[]).length !== 49 ||
  (traceability.states as unknown[]).length !== 175
) {
  fail("요구사항 49개와 상태 175개의 승인된 추적표가 아니다.");
}

if (
  (traceability.administrativeContractFunctions as unknown[]).length !== 14 ||
  (traceability.administrativeContractEvents as unknown[]).length !== 5 ||
  (traceability.administrativeContractErrors as unknown[]).length !== 5
) {
  fail("관리 ABI의 함수, 이벤트와 오류 추적표가 완전하지 않다.");
}

const matrixStates = stateTransitionMatrix.states as Array<{
  axis: string;
  stateCode: string;
  allowedTargets: string[];
  representativeForbiddenTargets: string[];
  forbiddenErrorCode: string | null;
}>;
const matrixCodes = new Set(matrixStates.map((entry) => entry.stateCode));
if (
  stateTransitionMatrix.totalStates !== 175 ||
  matrixStates.length !== 175 ||
  matrixCodes.size !== 175 ||
  (traceability.states as Array<{ stateCode: string }>).some(
    (entry) => !matrixCodes.has(entry.stateCode),
  )
) {
  fail("승인된 175개 상태가 기계 판독 전환표에 각각 한 번씩 있어야 한다.");
}
for (const entry of matrixStates) {
  if (
    entry.allowedTargets.some((target) => !matrixCodes.has(target)) ||
    entry.representativeForbiddenTargets.some((target) => !matrixCodes.has(target)) ||
    entry.representativeForbiddenTargets.some((target) => entry.allowedTargets.includes(target)) ||
    (entry.representativeForbiddenTargets.length > 0 &&
      entry.forbiddenErrorCode !== "STATE_CONFLICT")
  ) {
    fail(entry.stateCode + "의 허용·금지 전환표가 올바르지 않다.");
  }
}

type TraceEntry = Record<string, unknown> & { tests?: string[] };
const categories: Array<[string, string, string]> = [
  ["requirements", "requirementId", "requirementIds"],
  ["states", "stateCode", "stateCodes"],
  ["openApiOperations", "operationId", "openApiOperations"],
  ["asyncApiMessages", "messageName", "asyncApiMessages"],
  ["roles", "role", "roles"],
  ["invariants", "invariant", "invariants"],
];
for (const [traceKey, itemKey, implementationKey] of categories) {
  for (const item of traceability[traceKey] as TraceEntry[]) {
    const linkedTests =
      traceKey === "requirements"
        ? ([...(item.positiveTests as string[]), ...(item.negativeTests as string[])] as string[])
        : traceKey === "states"
          ? ([
              ...(item.tests ?? []),
              ...((item.allowedTransitionTests as string[]) ?? []),
              ...((item.forbiddenTransitionTests as string[]) ?? []),
            ] as string[])
          : (item.tests ?? []);
    for (const testId of new Set(linkedTests)) {
      const implementationCase = implementationCases.find((entry) => entry.testId === testId);
      if (!implementationCase?.traceability[implementationKey]?.includes(String(item[itemKey]))) {
        fail(traceKey + "." + String(item[itemKey]) + "와 " + testId + "의 양방향 연결이 끊겼다.");
      }
    }
  }
}

const contractCategories: Array<[string, string, string]> = [
  ["contractFunctions", "function", "contractFunctions"],
  ["administrativeContractFunctions", "function", "contractFunctions"],
  ["contractEvents", "event", "contractEvents"],
  ["administrativeContractEvents", "event", "contractEvents"],
  ["contractErrors", "error", "contractErrors"],
  ["administrativeContractErrors", "error", "contractErrors"],
];
for (const [traceKey, itemKey, implementationKey] of contractCategories) {
  for (const item of traceability[traceKey] as TraceEntry[]) {
    const itemId = String(item.contract ?? "governance") + "." + String(item[itemKey]);
    for (const testId of new Set(item.tests ?? [])) {
      const implementationCase = implementationCases.find((entry) => entry.testId === testId);
      if (!implementationCase?.traceability[implementationKey]?.includes(itemId)) {
        fail(traceKey + "." + itemId + "와 " + testId + "의 양방향 연결이 끊겼다.");
      }
    }
  }
}

for (const testCase of implementationCases) {
  for (const [key, values] of Object.entries(testCase.traceability)) {
    if (new Set(values).size !== values.length) {
      fail(testCase.testId + "의 " + key + " 추적항목이 중복됐다.");
    }
  }
}

const acceptanceSources = await Promise.all(
  localCases.map((entry) =>
    readFile(resolve(repositoryRoot, entry.primaryExecutable!.file), "utf8"),
  ),
);
const prohibitedTestControl = /\b(?:it|test|describe)\.(?:skip|todo)|\bretry\s*:\s*[1-9]/;
if (acceptanceSources.some((source) => prohibitedTestControl.test(source))) {
  fail("필수 인수시험에 skip, todo 또는 자동 재시도를 사용할 수 없다.");
}

process.stdout.write(
  "approved specs: 48 operations, 8 messages, 10 contracts, 79 tests (76 local + 3 Fuji), 49 requirements, 175 states, separate governance ABI\n",
);
