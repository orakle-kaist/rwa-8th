export interface ApiConfig {
  host: string;
  port: number;
  databaseUrl: string;
  testClockMode: "system" | "fixed";
  testClockIso?: string;
}

function readPort(raw: string | undefined): number {
  const port = Number(raw ?? "4000");
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("API_PORT는 1부터 65535까지의 정수여야 한다.");
  }
  return port;
}

export function loadApiConfig(environment: NodeJS.ProcessEnv): ApiConfig {
  const databaseUrl = environment.DATABASE_URL;
  if (!databaseUrl?.startsWith("postgresql://")) {
    throw new Error("PostgreSQL DATABASE_URL이 필요하다.");
  }
  const testClockMode = environment.TEST_CLOCK_MODE === "fixed" ? "fixed" : "system";
  return {
    host: environment.API_HOST ?? "0.0.0.0",
    port: readPort(environment.API_PORT),
    databaseUrl,
    testClockMode,
    ...(environment.TEST_CLOCK_ISO ? { testClockIso: environment.TEST_CLOCK_ISO } : {}),
  };
}
