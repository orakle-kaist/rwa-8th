import Link from "next/link";

import { InstitutionWorkspace } from "./institution-workspace";

export default function InstitutionFoundationPage() {
  return (
    <main className="workspaceShell">
      <header className="workspaceHeader">
        <Link href="/">K-EQUITY CONTROL</Link>
        <span className="simulationBadge">기관 콘솔 · 모의 환경</span>
      </header>
      <InstitutionWorkspace />
    </main>
  );
}
