import Link from "next/link";

import { InvestorWorkspace } from "./investor-workspace";
import type { DemoProfile } from "../lib/platform-api";

const demoProfiles = new Set<DemoProfile>(["investorA", "investorB", "denied", "expired"]);

export default async function InvestorFoundationPage({
  searchParams,
}: {
  searchParams: Promise<{ profile?: string }>;
}) {
  const requestedProfile = (await searchParams).profile as DemoProfile | undefined;
  const initialProfile =
    requestedProfile && demoProfiles.has(requestedProfile) ? requestedProfile : "investorA";

  return (
    <main className="workspaceShell">
      <header className="workspaceHeader">
        <Link href="/">K-EQUITY CONTROL</Link>
        <span className="simulationBadge">투자자 앱 · 모의 환경</span>
      </header>
      <InvestorWorkspace initialProfile={initialProfile} />
    </main>
  );
}
