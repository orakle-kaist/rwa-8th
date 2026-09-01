import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { Wallet } from "ethers";
import {
  defineChain,
  http,
  keccak256,
  stringToHex,
  toHex,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

const execFileAsync = promisify(execFile);

export const FUJI_CHAIN_ID = 43_113;
export const OFFICIAL_FUJI_RPC = "https://api.avax-test.network/ext/bc/C/rpc";
export const fujiChain = defineChain({
  id: FUJI_CHAIN_ID,
  name: "Avalanche Fuji C-Chain",
  nativeCurrency: { name: "Avalanche", symbol: "AVAX", decimals: 18 },
  rpcUrls: { default: { http: [OFFICIAL_FUJI_RPC] } },
  testnet: true,
});

export const fujiTransport = (rpcUrl: string) => http(rpcUrl, { timeout: 30_000 });

export type Artifact = { abi: Abi; bytecode: Hex | { object: Hex }; deployedBytecode?: Hex | { object: Hex } };

export type OfficialSecurity = {
  baseDate: string;
  shortCode: string;
  isin: string;
  market: string;
  itemName: string;
  corporationName: string | null;
};

export type OfficialIsinEvidence = {
  schemaVersion: "1.0.0";
  simulation: false;
  source: { receivedAt: string; rawResponseSha256: string };
  securities: OfficialSecurity[];
  evidenceSha256: string;
};

export function isinCheckDigitIsValid(value: string): boolean {
  if (!/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(value)) return false;
  const expanded = [...value.slice(0, -1)]
    .map((character) => {
      const code = character.charCodeAt(0);
      return code >= 65 && code <= 90 ? String(code - 55) : character;
    })
    .join("");
  const digits = `${expanded}${value.at(-1)}`;
  let sum = 0;
  let doubleDigit = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = Number(digits[index]);
    if (doubleDigit) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    doubleDigit = !doubleDigit;
  }
  return sum % 10 === 0;
}

export const roleAliases = [
  "deployer",
  "safeOwner1",
  "safeOwner2",
  "safeOwner3",
  "investor",
  "marketMaker",
  "brokerSigner",
  "eligibilityOperator",
  "executionConfirmer",
  "riskApprover",
  "rightsEntryApprover",
  "rightsRecordingConfirmer",
  "settlementConfirmer",
  "custodyConfirmer",
  "issuanceExecutor",
  "secondaryExecutor",
  "redemptionRightsApprover",
  "paymentApprover",
  "redemptionExecutor",
] as const;
export type RoleAlias = (typeof roleAliases)[number];

export const root = process.cwd();

export async function artifact(name: string, externalPath?: string): Promise<Artifact> {
  const path = externalPath ?? `contracts/out/${name}.sol/${name}.json`;
  return JSON.parse(await readFile(resolve(root, path), "utf8")) as Artifact;
}

export function artifactBytecode(item: Artifact): Hex {
  return typeof item.bytecode === "string" ? item.bytecode : item.bytecode.object;
}

export function artifactRuntimeBytecode(item: Artifact): Hex {
  if (!item.deployedBytecode) throw new Error("배포 후 바이트코드가 없는 계약 산출물이다.");
  return typeof item.deployedBytecode === "string"
    ? item.deployedBytecode
    : item.deployedBytecode.object;
}

export async function estimateFujiGas(
  rpcUrl: string,
  input: { from: Address; to?: Address; data: Hex; value?: bigint },
): Promise<bigint> {
  const transaction: Record<string, Hex | Address> = {
    from: input.from,
    data: input.data,
  };
  if (input.to) transaction.to = input.to;
  if (input.value !== undefined) transaction.value = toHex(input.value);
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_estimateGas",
      params: [transaction],
    }),
  });
  const payload = (await response.json()) as {
    result?: Hex;
    error?: { code?: number; message?: string };
  };
  if (!response.ok || !payload.result) {
    const message = payload.error?.message ?? `HTTP ${response.status}`;
    throw new Error(`Fuji 가스 추정에 실패했다: ${message}`);
  }
  const estimated = BigInt(payload.result);
  return (estimated * 120n) / 100n;
}

export async function loadOfficialIsins(): Promise<OfficialIsinEvidence> {
  const path = resolve(
    root,
    "research/korean-equity-rwa/sources/web/krx-listed-2026-08-28-representative-6.json",
  );
  const evidence = JSON.parse(await readFile(path, "utf8")) as OfficialIsinEvidence;
  if (evidence.simulation !== false || evidence.securities.length !== 6) {
    throw new Error("공식 ISIN 증거가 없거나 대표 6종목 검증을 통과하지 않았다.");
  }
  return evidence;
}

export async function loadFujiAccounts(): Promise<Record<RoleAlias, PrivateKeyAccount>> {
  const password = process.env.FUJI_KEYSTORE_PASSWORD;
  if (!password) throw new Error("FUJI_KEYSTORE_PASSWORD가 필요하다.");
  const directory = resolve(root, process.env.FUJI_KEYSTORE_DIR ?? ".runtime/fuji/keystores");
  const accounts = {} as Record<RoleAlias, PrivateKeyAccount>;
  for (const alias of roleAliases) {
    const encrypted = await readFile(resolve(directory, `${alias}.keystore.json`), "utf8");
    const wallet = await Wallet.fromEncryptedJson(encrypted, password);
    accounts[alias] = privateKeyToAccount(wallet.privateKey as Hex);
  }
  if (new Set(Object.values(accounts).map((account) => account.address.toLowerCase())).size !== roleAliases.length) {
    throw new Error("Fuji 시험 역할 주소가 서로 분리돼 있지 않다.");
  }
  return accounts;
}

export function role(name: string): Hex {
  return keccak256(stringToHex(name));
}

export function evidence(label: string): Hex {
  return keccak256(stringToHex(`FUJI_DEMO:${label}`));
}

export function workflow(label: string): Hex {
  return keccak256(stringToHex(`FUJI_WORKFLOW:${label}`)).slice(0, 34) as Hex;
}

export async function currentCommit(): Promise<string> {
  const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: root });
  return stdout.trim();
}

export function explorerTransaction(hash: Hex): string {
  return `https://explorer-test.avax.network/tx/${hash}`;
}

export function explorerAddress(address: Address): string {
  return `https://explorer-test.avax.network/address/${address}`;
}
