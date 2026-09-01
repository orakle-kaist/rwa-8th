import { access } from "node:fs/promises";
import { resolve } from "node:path";

import { deployLocalStack } from "../packages/contracts-client/src/index.js";

const root = resolve(import.meta.dirname, "..");
const requiredArtifacts = [
  "contracts/out/TimelockController.sol/TimelockController.json",
  "contracts/out/EligibilityRegistry.sol/EligibilityRegistry.json",
  "contracts/out/MarketPolicyRegistry.sol/MarketPolicyRegistry.json",
  "contracts/out/IntentVerifier.sol/IntentVerifier.json",
  "contracts/out/SecurityTokenFactory.sol/SecurityTokenFactory.json",
  "contracts/out/IssuanceController.sol/IssuanceController.json",
  "contracts/out/SecondarySettlementController.sol/SecondarySettlementController.json",
  "contracts/out/RedemptionController.sol/RedemptionController.json",
  "contracts/out/RecoveryController.sol/RecoveryController.json",
  "contracts/out/CorporateActionController.sol/CorporateActionController.json",
  "contracts/out/RestrictedEquityToken.sol/RestrictedEquityToken.json",
  "contracts/out/MockUsdc.sol/MockUsdc.json",
  "node_modules/@safe-global/safe-contracts/build/artifacts/contracts/SafeL2.sol/SafeL2.json",
  "node_modules/@safe-global/safe-contracts/build/artifacts/contracts/proxies/SafeProxyFactory.sol/SafeProxyFactory.json",
] as const;

const missingArtifacts: string[] = [];
for (const path of requiredArtifacts) {
  try {
    await access(resolve(root, path));
  } catch {
    missingArtifacts.push(path);
  }
}
if (missingArtifacts.length > 0) {
  throw new Error(
    `로컬 컨트랙트 배포 산출물이 누락됐다. Docker 이미지를 다시 빌드하거나 forge build를 실행한다.\n- ${missingArtifacts.join("\n- ")}`,
  );
}

const manifest = await deployLocalStack({
  ...(process.env.ANVIL_RPC_URL ? { rpcUrl: process.env.ANVIL_RPC_URL } : {}),
  ...(process.env.LOCAL_CHAIN_MANIFEST_PATH
    ? { outputPath: process.env.LOCAL_CHAIN_MANIFEST_PATH }
    : {}),
});
process.stdout.write(
  JSON.stringify(
    {
      simulation: true,
      chainId: manifest.chainId,
      contracts: manifest.contracts,
      tokens: manifest.tokens,
      governance: manifest.governance,
    },
    null,
    2,
  ) + "\n",
);
