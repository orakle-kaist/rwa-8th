import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { isinCheckDigitIsValid } from "./fuji-common.js";

const BASE_DATE = "20260828";
const ENDPOINT =
  "https://apis.data.go.kr/1160100/service/GetKrxListedInfoService/getItemInfo";
const OUTPUT = resolve(
  process.cwd(),
  "research/korean-equity-rwa/sources/web/krx-listed-2026-08-28-representative-6.json",
);

const targets = [
  { code: "005930", name: "삼성전자" },
  { code: "000660", name: "SK하이닉스" },
  { code: "017670", name: "SK텔레콤" },
  { code: "005380", name: "현대차" },
  { code: "035420", name: "NAVER" },
  { code: "006800", name: "미래에셋증권" },
] as const;

type ApiItem = {
  basDt?: string;
  srtnCd?: string;
  isinCd?: string;
  mrktCtg?: string;
  itmsNm?: string;
  corpNm?: string;
};

type ApiResponse = {
  response?: {
    header?: { resultCode?: string; resultMsg?: string };
    body?: { items?: { item?: ApiItem | ApiItem[] } };
  };
};

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

async function main() {
  const configuredServiceKey = process.env.DATA_GO_KR_SERVICE_KEY?.trim();
  if (!configuredServiceKey) {
    throw new Error(
      "DATA_GO_KR_SERVICE_KEY가 필요하다. 키는 셸 환경변수로만 설정하고 저장소에 기록하지 않는다.",
    );
  }
  let serviceKey = configuredServiceKey;
  if (/%[0-9A-Fa-f]{2}/.test(configuredServiceKey)) {
    try {
      serviceKey = decodeURIComponent(configuredServiceKey);
    } catch {
      throw new Error("DATA_GO_KR_SERVICE_KEY의 URL 인코딩 형식이 올바르지 않다.");
    }
  }

  const url = new URL(ENDPOINT);
  url.searchParams.set("serviceKey", serviceKey);
  url.searchParams.set("numOfRows", "5000");
  url.searchParams.set("pageNo", "1");
  url.searchParams.set("resultType", "json");
  url.searchParams.set("basDt", BASE_DATE);
  let response: Response;
  try {
    response = await fetch(url, { headers: { accept: "application/json" } });
  } catch {
    throw new Error("공식 KRX 종목 API 연결에 실패했다. 인증키와 원본 URL은 출력하지 않는다.");
  }
  if (!response.ok) throw new Error(`공식 KRX 종목 API가 HTTP ${response.status}를 반환했다.`);
  const rawText = await response.text();
  const payload = JSON.parse(rawText) as ApiResponse;
  const header = payload.response?.header;
  if (header?.resultCode !== "00") {
    throw new Error(`공식 API 오류: ${header?.resultCode ?? "UNKNOWN"} ${header?.resultMsg ?? ""}`);
  }
  const rawItems = payload.response?.body?.items?.item ?? [];
  const items = Array.isArray(rawItems) ? rawItems : [rawItems];
  const selected = targets.map((target) => {
    const matches = items.filter(
      (item) =>
        item.basDt === BASE_DATE &&
        (item.srtnCd === target.code || item.srtnCd === `A${target.code}`),
    );
    if (matches.length !== 1) {
      throw new Error(`${target.code} ${target.name} 공식 응답이 ${matches.length}건이다.`);
    }
    const item = matches[0]!;
    if (item.itmsNm !== target.name) {
      throw new Error(`${target.code} 종목명이 ${target.name}과 다르다: ${item.itmsNm ?? "없음"}`);
    }
    if (item.mrktCtg !== "KOSPI") {
      throw new Error(`${target.code} 시장이 KOSPI가 아니다: ${item.mrktCtg ?? "없음"}`);
    }
    if (!item.isinCd || !isinCheckDigitIsValid(item.isinCd)) {
      throw new Error(`${target.code} ISIN 형식 또는 검증숫자가 올바르지 않다.`);
    }
    return {
      baseDate: item.basDt,
      shortCode: target.code,
      sourceShortCode: item.srtnCd,
      isin: item.isinCd,
      market: item.mrktCtg,
      itemName: item.itmsNm,
      corporationName: item.corpNm ?? null,
    };
  });
  if (new Set(selected.map((item) => item.isin)).size !== selected.length) {
    throw new Error("대표 종목 사이에 중복 ISIN이 있다.");
  }

  const evidence = {
    schemaVersion: "1.0.0",
    simulation: false,
    source: {
      provider: "금융위원회",
      dataset: "금융위원회_KRX상장종목정보",
      portalUrl: "https://www.data.go.kr/data/15094775/openapi.do",
      endpoint: ENDPOINT,
      requestParameters: { basDt: BASE_DATE, resultType: "json", pageNo: 1, numOfRows: 5000 },
      receivedAt: new Date().toISOString(),
      rawResponseSha256: createHash("sha256").update(rawText).digest("hex"),
    },
    securities: selected,
  };
  const output = {
    ...evidence,
    evidenceSha256: createHash("sha256").update(canonical(evidence)).digest("hex"),
  };
  await mkdir(resolve(OUTPUT, ".."), { recursive: true });
  await writeFile(OUTPUT, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(`공식 ISIN 6개를 검증했다: ${OUTPUT}`);
  for (const item of selected) console.log(`${item.shortCode} ${item.itemName}: ${item.isin}`);
}

await main();
