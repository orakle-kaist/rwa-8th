import { readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { root } from "./fuji-common.js";

type FujiResult = {
  simulation: true;
  network: { name: string; chainId: number };
  gitCommit: string;
  officialIsinEvidenceSha256: string;
  mockPaymentAsset: { address: string; name: string; decimals: number; circleIssued: false };
  tests: Array<Record<string, unknown> & { testId: string; status: string }>;
  receipts: Array<{ label: string; hash: string; blockNumber: string; explorer: string }>;
  boundary: string;
};

async function main() {
  const evidenceRoot = resolve(root, "docs/10-poc-implementation/evidence/fuji");
  const directories = (await readdir(evidenceRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const latest = directories.at(-1);
  if (!latest) throw new Error("기록할 Fuji 시험 결과가 없다.");
  const result = JSON.parse(
    await readFile(resolve(evidenceRoot, latest, "result.json"), "utf8"),
  ) as FujiResult;
  if (result.tests.length !== 3 || result.tests.some((test) => test.status !== "PASSED")) {
    throw new Error("Fuji 시험 3개가 모두 통과하지 않아 승인 증거를 만들 수 없다.");
  }
  const deployment = result.tests.find((test) => test.testId === "Fuji-배포-01") as
    | { securities?: Array<{ shortCode: string; itemName: string; isin: string; token: string; explorer: string }> }
    | undefined;
  if (!deployment?.securities || deployment.securities.length !== 6) {
    throw new Error("대표 6종목 배포 증거가 완전하지 않다.");
  }
  const rows = deployment.securities
    .map(
      (security) =>
        `| ${security.itemName} | ${security.shortCode} | ${security.isin} | [${security.token}](${security.explorer}) |`,
    )
    .join("\n");
  const receiptRows = result.receipts
    .map((receipt) => `| ${receipt.label} | ${receipt.blockNumber} | [${receipt.hash}](${receipt.explorer}) |`)
    .join("\n");
  const document = `# 10단계 Fuji 배포와 검증 증거

상태: **Fuji 검증 완료, 10단계 구현 검토 대기**

이 문서는 커밋 \`${result.gitCommit}\`에서 수행한 Avalanche Fuji 시험 결과를 기록한다. 모든 토큰과 자금은 모의 테스트 전용이며 실제 한국주식, 고객 수탁권리나 법적 결제를 뜻하지 않는다.

## 공식 식별정보와 배포주소

- 네트워크: ${result.network.name}, chain ID ${result.network.chainId}
- 공식 ISIN 증거 체크섬: \`${result.officialIsinEvidenceSha256}\`
- 지급자산: ${result.mockPaymentAsset.name}, 소수점 ${result.mockPaymentAsset.decimals}, Circle 발행 아님

| 종목 | KRX 코드 | 공식 ISIN | Fuji 토큰 |
|---|---:|---|---|
${rows}

## 시험 결과

- \`Fuji-배포-01\`: 통과
- \`Fuji-직접이전차단-01\`: 통과
- \`Fuji-생애주기-01\`: 통과

삼성전자 모의 토큰 1주를 결제 대기로 발행하고 결제와 수탁 확인 뒤 거래 가능으로 전환했다. 투자자와 지정 시장조성자 사이에서 6자리 Mock USDC DvP를 수행한 뒤 시장조성자의 권리를 환매 잠금, 지급청구, 소각 대기와 소각으로 종료해 마지막 공급량을 0으로 확인했다.

## 거래 증거

| 단계 | 블록 | Fuji 거래 |
|---|---:|---|
${receiptRows}

## 해석 경계

${result.boundary} 공개 테스트넷의 성공은 실제 유동성, 가격 공정성, 규제 허용, 기관 계약이나 상용 보안을 입증하지 않는다. 개인키, 공공데이터 인증키, 전체 인증토큰과 전체 서명은 증거에 저장하지 않았다.
`;
  await writeFile(
    resolve(root, "docs/10-poc-implementation/FUJI_DEPLOYMENT_EVIDENCE.md"),
    document,
    "utf8",
  );
  console.log("추적 가능한 Fuji 배포 증거 문서를 만들었다.");
}

await main();
