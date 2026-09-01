import Link from "next/link";

import { InvestorWorkspace } from "../investor-workspace";
import { resolveProfile } from "../profile";

export default async function InvestorReviewerPage({ searchParams }: { searchParams: Promise<{ profile?: string }> }) {
  return <main className="workspaceShell"><header className="workspaceHeader"><Link href="/investor">← 투자자 홈</Link><span className="simulationBadge">검토 모드 · 내부 시험 제어</span></header><InvestorWorkspace initialProfile={await resolveProfile(searchParams)} /></main>;
}
