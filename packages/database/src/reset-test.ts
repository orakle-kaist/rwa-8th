import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL이 필요하다.");

const parsed = new URL(databaseUrl);
const databaseName = parsed.pathname.replace(/^\//, "");
if (!databaseName.endsWith("_test")) {
  throw new Error("시험 초기화는 이름이 _test로 끝나는 전용 데이터베이스에서만 허용한다.");
}

const pool = new Pool({ connectionString: databaseUrl });
try {
  // 브라우저 시연은 앞선 통합시험이 남긴 상태를 재사용하지 않는다.
  // 대상 데이터베이스 이름을 위에서 제한해 운영 데이터의 오삭제를 막는다.
  await pool.query("DROP SCHEMA public CASCADE");
  await pool.query("CREATE SCHEMA public");
  process.stdout.write(`isolated browser test database reset: ${databaseName}\n`);
} finally {
  await pool.end();
}
