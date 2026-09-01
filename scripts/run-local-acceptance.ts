import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const startedAt = new Date();
const testRunId = startedAt.toISOString().replaceAll(":", "-").replaceAll(".", "-");
const outputDirectory = resolve(root, "docs/10-poc-implementation/evidence/local", testRunId);
const temporaryResult = resolve(root, ".runtime", "acceptance-" + testRunId + ".json");
await mkdir(outputDirectory, { recursive: true });
await mkdir(resolve(root, ".runtime"), { recursive: true });

const commit = spawnSync("git", ["rev-parse", "HEAD"], {
  cwd: root,
  encoding: "utf8",
}).stdout.trim();
const dirty = spawnSync("git", ["status", "--porcelain"], {
  cwd: root,
  encoding: "utf8",
}).stdout.trim();
if (dirty) {
  throw new Error(
    "동일 커밋 증거를 만들기 전에 작업영역을 커밋해야 한다. 증거 폴더는 git에서 제외된다.",
  );
}

interface CommandResult {
  label: string;
  command: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  exitCode: number;
  logFile: string;
}
const commands: CommandResult[] = [];

async function run(label: string, args: string[]) {
  process.stdout.write("\n[로컬 인수시험] " + label + "\n");
  const commandStarted = new Date();
  const result = spawnSync("pnpm", args, { cwd: root, encoding: "utf8" });
  const commandFinished = new Date();
  const combined = (result.stdout ?? "") + (result.stderr ?? "");
  process.stdout.write(result.stdout ?? "");
  process.stderr.write(result.stderr ?? "");
  const logFile = label.replaceAll(/[^0-9A-Za-z가-힣_-]/g, "-") + ".log";
  await writeFile(resolve(outputDirectory, logFile), combined, "utf8");
  commands.push({
    label,
    command: "pnpm " + args.join(" "),
    startedAt: commandStarted.toISOString(),
    finishedAt: commandFinished.toISOString(),
    durationMs: commandFinished.getTime() - commandStarted.getTime(),
    exitCode: result.status ?? 1,
    logFile,
  });
  if (result.status !== 0) throw new Error(label + " 실패 (종료코드 " + (result.status ?? "없음") + ")");
}

try {
  await run("전체-로컬-기능-검증", ["test:full"]);
  const implementation = JSON.parse(
    await readFile(
      resolve(root, "docs/10-poc-implementation/specs/implementation-test-map.json"),
      "utf8",
    ),
  ) as {
    schemaVersion: string;
    cases: Array<{
      testId: string;
      automated: boolean;
      primaryExecutable: { file: string } | null;
      evidence: string[];
    }>;
  };
  const files = [
    ...new Set(
      implementation.cases
        .filter((entry) => entry.automated)
        .map((entry) => entry.primaryExecutable!.file),
    ),
  ];
  await run("승인-시험-76개", [
    "exec",
    "vitest",
    "run",
    ...files,
    "--reporter=json",
    "--outputFile=" + temporaryResult,
  ]);
  const vitest = JSON.parse(await readFile(temporaryResult, "utf8")) as {
    numPassedTests: number;
    numPendingTests: number;
    numFailedTests: number;
    testResults: Array<{
      name: string;
      assertionResults: Array<{ title: string; status: string; duration?: number }>;
    }>;
  };
  const assertions = vitest.testResults.flatMap((file) =>
    file.assertionResults.map((assertion) => ({
      testId: assertion.title,
      result: assertion.status.toUpperCase(),
      durationMs: assertion.duration ?? 0,
      file: file.name.replace(root + "/", ""),
    })),
  );
  const approvedLocalIds = implementation.cases
    .filter((entry) => entry.automated)
    .map((entry) => entry.testId);
  const resultIds = new Set(assertions.map((entry) => entry.testId));
  if (
    vitest.numPassedTests !== 76 ||
    vitest.numPendingTests !== 0 ||
    vitest.numFailedTests !== 0 ||
    resultIds.size !== 76 ||
    approvedLocalIds.some((testId) => !resultIds.has(testId))
  ) {
    throw new Error("76개 승인 로컬 시험이 독립된 무건너뜀 결과로 남지 않았다.");
  }

  const fixtureBytes = await readFile(
    resolve(root, "docs/09-test-design/specs/test-fixtures.json"),
  );
  const implementationBytes = await readFile(
    resolve(root, "docs/10-poc-implementation/specs/implementation-test-map.json"),
  );
  const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
  const finishedAt = new Date();
  await writeFile(
    resolve(outputDirectory, "result.json"),
    JSON.stringify(
      {
        testRunId,
        commit,
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        simulation: true,
        automaticRetry: false,
        skipped: 0,
        specification: {
          implementationMapVersion: implementation.schemaVersion,
          implementationMapSha256: sha256(implementationBytes),
          fixtureSha256: sha256(fixtureBytes),
        },
        commands,
        localAutomated: assertions,
        fuji: {
          result: "NOT_RUN",
          testCount: 3,
          reason: "대표 6종목 공식 ISIN 확인과 Fuji 승인 게이트 전",
        },
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  await writeFile(
    resolve(outputDirectory, "reconciliation.json"),
    JSON.stringify(
      {
        simulation: true,
        verifiedBy: [
          "PostgreSQL 통합시험의 고객별 수탁권리, 국내 통합계좌와 토큰 공급량 대사",
          "Foundry 불변식 시험의 전체 발행량과 다섯 수량 상태 합계",
          "환매 지급청구, 소각 대기와 USD 지급 연결",
        ],
        officialCandidates: { count: 201, enabled: 0 },
        representativeCandidates: { count: 6, enabled: 0 },
        enabledSyntheticProducts: ["990001", "990002", "990003"],
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  await writeFile(
    resolve(outputDirectory, "chain-and-ui.json"),
    JSON.stringify(
      {
        simulation: true,
        chain: {
          network: "local Anvil",
          result: "PASSED",
          evidence:
            "Foundry와 viem 통합시험이 발행, 제한이전, USDC DvP, 환매·소각 영수증과 이벤트를 검증했다. 시험별 임시 키와 전체 서명은 보존하지 않는다.",
        },
        ui: {
          browser: "Chromium",
          result: "PASSED",
          evidence:
            "Playwright가 투자자 앱과 기관 콘솔의 전체 생애주기, 차단사유와 모의 표시를 검증했다.",
        },
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  process.stdout.write("\n로컬 인수시험 증거: " + outputDirectory + "\n");
} catch (error) {
  await writeFile(
    resolve(outputDirectory, "failed-run.json"),
    JSON.stringify(
      {
        testRunId,
        commit,
        startedAt: startedAt.toISOString(),
        failedAt: new Date().toISOString(),
        simulation: true,
        commands,
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  throw error;
} finally {
  await rm(temporaryResult, { force: true });
}
