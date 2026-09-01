import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { createClock } from "@rwa/domain";
import { Pool } from "pg";

import { seedProtectionData } from "./seed-protection.js";
import { seedPrimaryData } from "./seed-primary.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL이 필요하다.");
}

const pool = new Pool({ connectionString: databaseUrl });
const clock = createClock(process.env);

try {
  for (const name of [
    "0001_foundation.sql",
    "0002_customer_product_protection.sql",
    "0003_primary_issuance.sql",
    "0004_secondary_trading.sql",
    "0005_market_maker_hedges.sql",
    "0006_redemptions.sql",
  ]) {
    const migrationUrl = new URL(`../migrations/${name}`, import.meta.url);
    await pool.query(await readFile(fileURLToPath(migrationUrl), "utf8"));
  }
  await seedProtectionData(pool);
  await seedPrimaryData(pool);
  const { seedSecondaryData } = await import("./seed-secondary.js");
  // 데이터 적재와 API가 같은 주입 시계를 사용해야 60초 신선도 경계를
  // 시스템 실행과 고정시각 시험에서 동일하게 판정할 수 있다.
  await seedSecondaryData(pool, clock.now());
  process.stdout.write("database migrations and approved synthetic reference data applied\n");
} finally {
  await pool.end();
}
