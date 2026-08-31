import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL이 필요하다.");
}

const migrationUrl = new URL("../migrations/0001_foundation.sql", import.meta.url);
const sql = await readFile(fileURLToPath(migrationUrl), "utf8");
const pool = new Pool({ connectionString: databaseUrl });

try {
  await pool.query(sql);
  process.stdout.write("database foundation migration applied\n");
} finally {
  await pool.end();
}
