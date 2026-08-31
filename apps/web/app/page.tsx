import Link from "next/link";

const lifecycle = [
  "고객확인",
  "1차 발행",
  "T+2 전환",
  "24/7 제한 거래",
  "시장조성자 헤지",
  "환매와 권리업무",
];

export default function HomePage() {
  return (
    <main>
      <header className="topbar">
        <div className="brand">K-EQUITY CONTROL</div>
        <div className="simulationBadge">모의 환경 · 실제 자산 없음</div>
      </header>

      <section className="hero">
        <p className="eyebrow">INSTITUTIONAL PROOF OF CONCEPT</p>
        <h1>
          한국형 규제 수탁 권리의
          <br />
          24/7 2차시장 통제
        </h1>
        <p className="lead">
          외국인 통합계좌의 결제 완료 수탁권리를 제한형 토큰으로 표시하고, 지정 시장조성자와 적격
          투자자 사이의 거래를 통제하는 합성 시연 환경이다.
        </p>

        <div className="entryGrid">
          <Link className="entryCard primary" href="/investor">
            <span className="entryLabel">투자자 앱</span>
            <strong>주문과 보유권리 확인</strong>
            <small>합성 고객확인, 발행, 24/7 거래와 환매</small>
          </Link>
          <Link className="entryCard" href="/institution">
            <span className="entryLabel">통합 기관 콘솔</span>
            <strong>승인과 통제 확인</strong>
            <small>기관 인계, 시장조성, 대사와 감사</small>
          </Link>
        </div>
      </section>

      <section className="lifecycle" aria-label="PoC 생애주기">
        {lifecycle.map((step, index) => (
          <div className="lifecycleStep" key={step}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            <p>{step}</p>
          </div>
        ))}
      </section>

      <footer>토큰은 고객 권리의 기준장부가 아니다. 모든 기관 응답과 자금은 합성 데이터다.</footer>
    </main>
  );
}
