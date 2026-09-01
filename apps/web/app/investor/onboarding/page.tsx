import Link from "next/link";

import { InvestorOnboarding } from "./investor-onboarding";

export default function InvestorOnboardingPage() {
  return (
    <main className="workspaceShell onboardingShell">
      <header className="workspaceHeader">
        <Link href="/">K-EQUITY CONTROL</Link>
        <span className="simulationBadge">모의 계좌 개설 · 실제 개인정보 없음</span>
      </header>
      <InvestorOnboarding />
    </main>
  );
}
