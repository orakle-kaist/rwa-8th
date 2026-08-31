import Link from "next/link";

export default function InvestorFoundationPage() {
  return (
    <main className="workspaceShell">
      <header className="workspaceHeader">
        <Link href="/">K-EQUITY CONTROL</Link>
        <span className="simulationBadge">투자자 앱 · 모의 환경</span>
      </header>
      <section className="foundationPanel">
        <p className="eyebrow">STAGE 10 FOUNDATION</p>
        <h1>투자자 업무공간</h1>
        <p>실행 기반이 준비됐다. 다음 기능 커밋에서 고객확인과 상품 통제를 연결한다.</p>
        <div className="statusRow">
          <span>API 계약</span>
          <strong>47개 동작 연결 준비</strong>
        </div>
        <div className="statusRow">
          <span>지갑</span>
          <strong>브라우저 서명 연결 대기</strong>
        </div>
      </section>
    </main>
  );
}
