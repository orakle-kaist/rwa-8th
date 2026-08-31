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
] = await Promise.all([
  readYaml("docs/07-data-api-events/specs/openapi.platform.yaml"),
  readYaml("docs/07-data-api-events/specs/openapi.adapters.yaml"),
  readYaml("docs/07-data-api-events/specs/asyncapi.yaml"),
  readJson("docs/08-smart-contract-design/specs/contract-manifest.json"),
  readJson("docs/08-smart-contract-design/specs/contract-abi.json"),
  readJson("docs/08-smart-contract-design/specs/governance-abi.json"),
  readJson("docs/09-test-design/specs/test-catalog.json"),
  readJson("docs/09-test-design/specs/traceability.json"),
]);

const operations = [...operationIds(platformApi), ...operationIds(adapterApi)];
if (operations.length !== 47 || new Set(operations).size !== 47) {
  fail(`OpenAPI 동작은 서로 다른 47개여야 하지만 ${operations.length}개다.`);
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
if (contracts.length !== 10 || functionCount !== 64 || eventCount !== 38) {
  fail("계약 수, 함수 수 또는 이벤트 수가 승인된 10·64·38과 다르다.");
}

const errors = contractAbi.errors as unknown[];
const roles = manifest.roles as unknown[];
const invariants = manifest.requiredInvariants as unknown[];
if (errors.length !== 16 || roles.length !== 20 || invariants.length !== 9) {
  fail("오류, 역할 또는 불변식 수가 승인된 16·20·9와 다르다.");
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
  (governanceAbi.accessControlContracts as unknown[]).length !== 5 ||
  accessControl.functions.length !== 7 ||
  accessControl.events.length !== 3 ||
  accessControl.errors.length !== 2 ||
  extensionFunctionCount !== 6
) {
  fail("관리 ABI가 승인된 역할관리 및 기반 계약 조회 범위와 다르다.");
}

const groups = testCatalog.groups as Array<{ cases: unknown[] }>;
const testCount = groups.reduce((total, group) => total + group.cases.length, 0);
if (testCatalog.status !== "APPROVED" || testCount !== 78) {
  fail(`승인된 필수 시험은 78개여야 하지만 ${testCount}개다.`);
}

if (
  traceability.status !== "APPROVED" ||
  (traceability.requirements as unknown[]).length !== 49 ||
  (traceability.states as unknown[]).length !== 174
) {
  fail("요구사항 49개와 상태 174개의 승인된 추적표가 아니다.");
}

if (
  (traceability.administrativeContractFunctions as unknown[]).length !== 13 ||
  (traceability.administrativeContractEvents as unknown[]).length !== 5 ||
  (traceability.administrativeContractErrors as unknown[]).length !== 4
) {
  fail("관리 ABI의 함수, 이벤트와 오류 추적표가 완전하지 않다.");
}

process.stdout.write(
  "approved specs: 47 operations, 8 messages, 10 contracts, 78 tests, 49 requirements, 174 states, separate governance ABI\n",
);
