import Link from "next/link";

export default function InstitutionFoundationPage() {
  return (
    <main className="workspaceShell">
      <header className="workspaceHeader">
        <Link href="/">K-EQUITY CONTROL</Link>
        <span className="simulationBadge">기관 콘솔 · 모의 환경</span>
      </header>
      <section className="foundationPanel">
        <p className="eyebrow">STAGE 10 FOUNDATION</p>
        <h1>통합 기관 콘솔</h1>
        <p>역할 전환은 화면 범위만 바꾸며 실제 실행 권한을 부여하지 않는다.</p>
        <div className="statusRow">
          <span>PostgreSQL</span>
          <strong>업무·증거·발송함</strong>
        </div>
        <div className="statusRow">
          <span>로컬 체인</span>
          <strong>Anvil 31337</strong>
        </div>
      </section>
    </main>
  );
}
