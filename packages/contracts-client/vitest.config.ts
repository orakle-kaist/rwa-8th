import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.integration.test.ts"],
    fileParallelism: false,
    retry: 0,
    setupFiles: ["./test/setup-anvil.ts"],
    // 여러 계약을 순차 배포하는 통합시험은 부하가 있는 로컬 환경에서도
    // 자동 재시도 없이 한 번에 완료할 수 있는 명시적 시간 예산을 사용한다.
    testTimeout: 20_000,
  },
});
