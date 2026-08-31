import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

type AbiParameter = {
  name?: string;
  type: string;
  internalType?: string;
  indexed?: boolean;
  components?: AbiParameter[];
};

type AbiItem = {
  type: "function" | "event" | "error";
  name: string;
  stateMutability?: string;
  inputs?: AbiParameter[];
  outputs?: AbiParameter[];
};

type BusinessContract = { name: string; functions: AbiItem[]; events: AbiItem[] };

const repositoryRoot = resolve(import.meta.dirname, "../../..");
const implementedContracts = [
  "RestrictedEquityToken",
  "EligibilityRegistry",
  "SecurityTokenFactory",
  "IntentVerifier",
  "MarketPolicyRegistry",
  "IssuanceController",
] as const;

async function readJson(relativePath: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(resolve(repositoryRoot, relativePath), "utf8")) as Record<
    string,
    unknown
  >;
}

function fail(message: string): never {
  throw new Error(`컴파일 ABI 검증 실패: ${message}`);
}

function names(items: Array<{ name: string }>): Set<string> {
  return new Set(items.map((item) => item.name));
}

function normalizeType(parameter: AbiParameter): string {
  if (parameter.type.startsWith("tuple") && parameter.internalType?.startsWith("struct ")) {
    const structName = parameter.internalType.split(" ")[1]?.split(".").at(-1);
    if (!structName) fail(`구조체 자료형을 해석할 수 없다: ${parameter.internalType}`);
    return `${structName}${parameter.type.slice("tuple".length)}`;
  }
  return parameter.type;
}

function sameParameters(
  expected: AbiParameter[],
  actual: AbiParameter[],
  includeIndexed: boolean,
): boolean {
  return (
    expected.length === actual.length &&
    expected.every(
      (parameter, index) =>
        (parameter.name ?? "") === (actual[index]?.name ?? "") &&
        parameter.type === normalizeType(actual[index]!) &&
        (!includeIndexed || parameter.indexed === Boolean(actual[index]?.indexed)),
    )
  );
}

const [businessAbi, governanceAbi] = await Promise.all([
  readJson("docs/08-smart-contract-design/specs/contract-abi.json"),
  readJson("docs/08-smart-contract-design/specs/governance-abi.json"),
]);

const businessContracts = new Map(
  (businessAbi.contracts as BusinessContract[]).map((contract) => [contract.name, contract]),
);
const standard = governanceAbi.standardAccessControl as {
  functions: AbiItem[];
  events: AbiItem[];
  errors: AbiItem[];
};
const extensions = new Map(
  (
    governanceAbi.contractExtensions as Array<{
      contract: string;
      functions: AbiItem[];
      events: AbiItem[];
      errors: AbiItem[];
    }>
  ).map((extension) => [extension.contract, extension]),
);
const businessErrors = businessAbi.errors as AbiItem[];
const allowedBusinessErrors = names(businessErrors);

function verifyFunction(contractName: string, expected: AbiItem, actualItems: AbiItem[]): void {
  const actual = actualItems.find((item) => item.name === expected.name);
  if (
    !actual ||
    actual.stateMutability !== expected.stateMutability ||
    !sameParameters(expected.inputs ?? [], actual.inputs ?? [], false) ||
    !sameParameters(expected.outputs ?? [], actual.outputs ?? [], false)
  ) {
    fail(`${contractName}.${expected.name} 함수 서명이 승인된 ABI와 다르다.`);
  }
}

function verifyEvent(contractName: string, expected: AbiItem, actualItems: AbiItem[]): void {
  const actual = actualItems.find((item) => item.name === expected.name);
  if (!actual || !sameParameters(expected.inputs ?? [], actual.inputs ?? [], true)) {
    fail(`${contractName}.${expected.name} 이벤트 서명이 승인된 ABI와 다르다.`);
  }
}

function verifyError(contractName: string, expected: AbiItem, actualItems: AbiItem[]): void {
  const actual = actualItems.find((item) => item.name === expected.name);
  if (!actual || !sameParameters(expected.inputs ?? [], actual.inputs ?? [], false)) {
    fail(`${contractName}.${expected.name} 오류 서명이 승인된 ABI와 다르다.`);
  }
}

for (const contractName of implementedContracts) {
  const artifact = await readJson(`contracts/out/${contractName}.sol/${contractName}.json`);
  const compiled = artifact.abi as AbiItem[];
  const business = businessContracts.get(contractName);
  if (!business) fail(`${contractName}의 업무 ABI가 없다.`);
  const extension = extensions.get(contractName) ?? {
    functions: [],
    events: [],
    errors: [],
  };

  const expectedFunctionNames = new Set([
    ...business.functions.map((item) => item.name),
    ...standard.functions.map((item) => item.name),
    ...extension.functions.map((item) => item.name),
  ]);
  const expectedEventNames = new Set([
    ...business.events.map((item) => item.name),
    ...standard.events.map((item) => item.name),
    ...extension.events.map((item) => item.name),
  ]);
  const allowedErrorNames = new Set([
    ...allowedBusinessErrors,
    ...standard.errors.map((item) => item.name),
    ...extension.errors.map((item) => item.name),
  ]);

  const compiledFunctions = compiled.filter((item) => item.type === "function");
  const compiledEvents = compiled.filter((item) => item.type === "event");
  const compiledErrors = compiled.filter((item) => item.type === "error");
  const actualFunctionNames = new Set(compiledFunctions.map((item) => item.name));
  const actualEventNames = new Set(compiledEvents.map((item) => item.name));

  if (
    expectedFunctionNames.size !== actualFunctionNames.size ||
    [...expectedFunctionNames].some((name) => !actualFunctionNames.has(name))
  ) {
    fail(`${contractName} 공개 함수가 업무 ABI와 관리 ABI의 합집합과 다르다.`);
  }
  if (
    expectedEventNames.size !== actualEventNames.size ||
    [...expectedEventNames].some((name) => !actualEventNames.has(name))
  ) {
    fail(`${contractName} 이벤트가 업무 ABI와 관리 ABI의 합집합과 다르다.`);
  }
  const unexpectedErrors = compiledErrors
    .map((item) => item.name)
    .filter((name) => !allowedErrorNames.has(name));
  if (unexpectedErrors.length > 0) {
    fail(`${contractName}에 승인되지 않은 오류가 있다: ${unexpectedErrors.join(", ")}`);
  }

  for (const expected of [...business.functions, ...standard.functions, ...extension.functions])
    verifyFunction(contractName, expected, compiledFunctions);
  for (const expected of [...business.events, ...standard.events, ...extension.events])
    verifyEvent(contractName, expected, compiledEvents);
  for (const expected of [...standard.errors, ...extension.errors])
    verifyError(contractName, expected, compiledErrors);
  for (const expected of businessErrors.filter((item) =>
    compiledErrors.some((actual) => actual.name === item.name),
  ))
    verifyError(contractName, expected, compiledErrors);
}

process.stdout.write(
  "compiled contract artifacts match the approved business and governance ABI boundaries\n",
);
