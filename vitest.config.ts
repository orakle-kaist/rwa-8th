import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: { enabled: false },
    environment: "node",
    include: ["apps/**/*.test.ts", "packages/**/*.test.ts", "tests/acceptance/**/*.test.ts"],
    passWithNoTests: false,
    retry: 0,
    sequence: { concurrent: false },
  },
});
