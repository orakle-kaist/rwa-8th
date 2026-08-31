import { describe, expect, it } from "vitest";

import { createChainReader } from "../src/index.js";

describe("Anvil 체인 연결", () => {
  it("로컬 체인의 승인된 chain ID를 확인한다", async () => {
    const rpcUrl = process.env.ANVIL_RPC_URL ?? "http://127.0.0.1:8545";
    const client = createChainReader(rpcUrl, 31_337);

    await expect(client.getChainId()).resolves.toBe(31_337);
  });
});
