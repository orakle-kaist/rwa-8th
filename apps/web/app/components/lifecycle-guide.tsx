interface LifecycleStep {
  id: string;
  anchorId?: string;
  label: string;
  stateCode: string;
  detail: string;
  owner: string;
  sourceRecord: string;
  nextAction: string;
  blockedReason?: string;
  blocked?: boolean;
}

const labels: Record<string, string> = {
  READY: "준비 완료",
  ACTION_REQUIRED: "조치 필요",
  NOT_STARTED: "시작 전",
  IN_PROGRESS: "진행 중",
  COMPLETED: "완료",
  WAITING_INSTITUTION: "기관 확인 대기",
  BLOCKED: "차단",
};

export function LifecycleGuide({
  title,
  description,
  steps,
}: {
  title: string;
  description: string;
  steps: LifecycleStep[];
}) {
  const current =
    steps.find((step) => step.blocked || !["READY", "COMPLETED"].includes(step.stateCode)) ??
    steps.at(-1);

  return (
    <section className="demoGuide" aria-label={title}>
      <div className="demoGuideHeading">
        <div>
          <p className="eyebrow">GUIDED DEMO</p>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
        {current ? (
          <aside className="nextActionCard">
            <span>지금 할 일</span>
            <strong>{current.nextAction}</strong>
            <small>책임: {current.owner}</small>
          </aside>
        ) : null}
      </div>
      <nav className="demoSteps" aria-label="시연 단계 바로가기">
        {steps.map((step, index) => (
          <a
            className={step.blocked ? "demoStep blocked" : "demoStep"}
            href={`#${step.anchorId ?? step.id}`}
            key={step.id}
          >
            <span>{String(index + 1).padStart(2, "0")}</span>
            <strong>{step.label}</strong>
            <em>{labels[step.stateCode] ?? step.stateCode}</em>
            <small>{step.detail}</small>
            <small>기준 기록: {step.sourceRecord}</small>
            {step.blockedReason ? (
              <small className="blockedReason">{step.blockedReason}</small>
            ) : null}
            <details>
              <summary>상세 상태</summary>
              <code>{step.stateCode}</code>
            </details>
          </a>
        ))}
      </nav>
      <p className="guideBoundary">
        24/7은 KRX가 24시간 열리는 것이 아니라, 국내 통합 보유총량을 바꾸지 않고 인가 해외 증권사의
        고객별 수탁권리를 투자자와 지정 시장조성자 사이에서 재배분하는 모의 거래다. 토큰은 고객
        권리의 기준장부가 아니며, 이 화면의 고객·기관·주식·자금·체인 응답은 모두 합성·모의 데이터다.
      </p>
    </section>
  );
}
