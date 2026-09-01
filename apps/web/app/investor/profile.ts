import type { DemoProfile } from "../lib/platform-api";

const profiles = new Set<DemoProfile>(["investorA", "investorB", "denied", "expired"]);

export async function resolveProfile(searchParams: Promise<{ profile?: string }>) {
  const value = (await searchParams).profile as DemoProfile | undefined;
  return value && profiles.has(value) ? value : "investorA";
}
