import { deployLocalStack } from "../packages/contracts-client/src/index.js";

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
