import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { Pool } from "pg";

import { seedProtectionData } from "./seed-protection.js";
import { seedPrimaryData } from "./seed-primary.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL이 필요하다.");
}

const pool = new Pool({ connectionString: databaseUrl });

try {
  for (const name of [
    "0001_foundation.sql",
    "0002_customer_product_protection.sql",
    "0003_primary_issuance.sql",
    "0004_secondary_trading.sql",
    "0005_market_maker_hedges.sql",
  ]) {
    const migrationUrl = new URL(`../migrations/${name}`, import.meta.url);
    await pool.query(await readFile(fileURLToPath(migrationUrl), "utf8"));
  }
  await seedProtectionData(pool);
  await seedPrimaryData(pool);
  const { seedSecondaryData } = await import("./seed-secondary.js");
  await seedSecondaryData(pool, new Date());
  process.stdout.write("database migrations and approved synthetic reference data applied\n");
} finally {
  await pool.end();
}
