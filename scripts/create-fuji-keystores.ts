import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { Wallet } from "ethers";

const aliases = [
  "deployer",
  "safeOwner1",
  "safeOwner2",
  "safeOwner3",
  "investor",
  "marketMaker",
  "brokerSigner",
  "eligibilityOperator",
  "executionConfirmer",
  "riskApprover",
  "rightsEntryApprover",
  "rightsRecordingConfirmer",
  "settlementConfirmer",
  "custodyConfirmer",
  "issuanceExecutor",
  "secondaryExecutor",
  "redemptionRightsApprover",
  "paymentApprover",
  "redemptionExecutor",
] as const;

async function main() {
  const password = process.env.FUJI_KEYSTORE_PASSWORD;
  if (!password || password.length < 12) {
    throw new Error("FUJI_KEYSTORE_PASSWORD는 12자 이상이어야 하며 셸 환경변수로만 제공한다.");
  }
  const directory = resolve(
    process.cwd(),
    process.env.FUJI_KEYSTORE_DIR ?? ".runtime/fuji/keystores",
  );
  const publicManifestPath = resolve(directory, "..", "public-addresses.json");
  await mkdir(directory, { recursive: true, mode: 0o700 });

  const addresses: Record<string, string> = {};
  for (const alias of aliases) {
    const path = resolve(directory, `${alias}.keystore.json`);
    try {
      const existing = JSON.parse(await readFile(path, "utf8")) as { address?: string };
      if (!existing.address) throw new Error(`${alias} 키 저장소에 주소가 없다.`);
      addresses[alias] = `0x${existing.address.toLowerCase().replace(/^0x/, "")}`;
      continue;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const wallet = Wallet.createRandom();
    const encrypted = await wallet.encrypt(password);
    await writeFile(path, `${encrypted}\n`, { encoding: "utf8", mode: 0o600 });
    await chmod(path, 0o600);
    addresses[alias] = wallet.address;
  }
  const manifest = {
    schemaVersion: "1.0.0",
    chainId: 43113,
    generatedAt: new Date().toISOString(),
    simulation: true,
    addresses,
    fundingInstruction: "deployer 주소에만 Fuji 시험 AVAX를 충전한다.",
  };
  await mkdir(resolve(publicManifestPath, ".."), { recursive: true, mode: 0o700 });
  await writeFile(publicManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  console.log(`Fuji 시험 전용 암호화 키 저장소를 준비했다: ${directory}`);
  console.log(`시험 AVAX 충전 주소: ${addresses.deployer}`);
  console.log("개인키와 암호는 출력하거나 저장소에 기록하지 않았다.");
}

await main();
