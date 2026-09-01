import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { executeApprovedCase } from "./run-approved-case.js";

const root = resolve(import.meta.dirname, "../..");

interface ImplementationCase {
  testId: string;
  groupId: string;
  automated: boolean;
  primaryExecutable: { runner: string; file: string; testName: string } | null;
  evidence: string[];
  status: string;
}

const implementation = JSON.parse(
  await readFile(
    resolve(root, "docs/10-poc-implementation/specs/implementation-test-map.json"),
    "utf8",
  ),
) as { cases: ImplementationCase[] };

export function registerApprovedTests(groupId: string) {
  const cases = implementation.cases.filter(
    (entry) => entry.automated && entry.groupId === groupId,
  );
  describe(groupId + " 실행형 승인 인수시험", () => {
    for (const testCase of cases) {
      it(testCase.testId, async () => {
        expect(testCase.status).toBe("LOCAL_AUTOMATED");
        expect(testCase.primaryExecutable?.testName).toBe(testCase.testId);
        const result = await executeApprovedCase(testCase.testId);
        expect(result.testId).toBe(testCase.testId);
        expect(result.executedAssertions).toBeGreaterThan(0);
        expect(result.evidence.length).toBeGreaterThan(0);
      });
    }
  });
}
