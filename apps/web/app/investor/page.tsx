import Link from "next/link";

import { InvestorWorkspace } from "./investor-workspace";

export default function InvestorFoundationPage() {
  return (
    <main className="workspaceShell">
      <header className="workspaceHeader">
        <Link href="/">K-EQUITY CONTROL</Link>
        <span className="simulationBadge">투자자 앱 · 모의 환경</span>
      </header>
      <InvestorWorkspace />
    </main>
  );
}
