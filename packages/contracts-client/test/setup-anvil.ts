import { createPublicClient, http } from "viem";

import { anvilChain } from "../src/index.js";

const rpcUrl = process.env.ANVIL_RPC_URL ?? "http://127.0.0.1:8545";
const transport = http(rpcUrl);
const publicClient = createPublicClient({ chain: anvilChain, transport });
const chainId = await publicClient.getChainId();

if (chainId !== 31_337) {
  throw new Error(`로컬 체인 초기화는 Anvil chainId 31337에서만 허용한다: ${chainId}`);
}

// 각 통합시험 파일은 이전 실행의 계정 nonce와 계약 상태를 물려받지 않는다.
// viem의 reset 도우미는 포크 설정을 전송하므로 비포크 Anvil에는 원시 RPC를 사용한다.
const response = await fetch(rpcUrl, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "anvil_reset", params: [] }),
});
const result = (await response.json()) as { error?: { message?: string } };
if (!response.ok || result.error) {
  throw new Error(`Anvil 초기화에 실패했다: ${result.error?.message ?? response.statusText}`);
}
