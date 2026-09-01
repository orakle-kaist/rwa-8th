import Link from "next/link";
import { InstitutionWorkspace } from "../institution-workspace";

export default function InstitutionOperationsPage() {
  return <main className="workspaceShell"><header className="workspaceHeader"><Link href="/institution">← 업무 대시보드</Link><span className="simulationBadge">상세 승인·시험 제어 · 모의 환경</span></header><InstitutionWorkspace /></main>;
}
