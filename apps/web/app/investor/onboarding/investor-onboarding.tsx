"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import {
  demoTokens,
  platformFetch,
  type Consent,
  type DemoProfile,
  type Disclosure,
  type Session,
} from "../../lib/platform-api";

const steps = [
  "계좌 개설",
  "합성 여권",
  "고객확인",
  "투자자 보호",
  "위험공시",
  "전용 지갑",
  "심사 결과",
] as const;

const scenarios: Record<
  DemoProfile,
  {
    label: string;
    customerReference: string;
    residence: string;
    funding: string;
    passportMark: string;
    description: string;
  }
> = {
  investorA: {
    label: "허용 고객 A",
    customerReference: "SIM-CUSTOMER-A",
    residence: "모의 판매 허용 관할",
    funding: "USD 고객계좌",
    passportMark: "SIM-A-XXXX",
    description: "정상 고객확인과 USD 주문 흐름을 확인한다.",
  },
  investorB: {
    label: "허용 고객 B",
    customerReference: "SIM-CUSTOMER-B",
    residence: "모의 판매 허용 관할",
    funding: "USDC 전환 경로",
    passportMark: "SIM-B-XXXX",
    description: "정상 고객확인과 USDC 주문 흐름을 확인한다.",
  },
  denied: {
    label: "거절 고객",
    customerReference: "SIM-CUSTOMER-DENIED",
    residence: "모의 판매 제한 관할",
    funding: "사용 불가",
    passportMark: "SIM-D-XXXX",
    description: "판매 가능 판정이 거절됐을 때의 차단과 안내를 확인한다.",
  },
  expired: {
    label: "판정 만료 고객",
    customerReference: "SIM-CUSTOMER-EXPIRED",
    residence: "모의 재확인 대상 관할",
    funding: "재확인 전 사용 불가",
    passportMark: "SIM-E-XXXX",
    description: "고객확인 유효기간이 끝났을 때의 재확인 안내를 확인한다.",
  },
};

const quizItems = [
  "기초주식은 국내 통합계좌에 보관되고 고객 권리는 해외 증권사의 원장에서 관리됨을 이해했다.",
  "국내 결제 대기 토큰은 T+2 결제와 수탁 확인 전까지 거래할 수 없음을 이해했다.",
  "토큰은 자유롭게 전송할 수 없고 지정 시장조성자와의 승인된 거래만 가능함을 이해했다.",
] as const;

function statusLabel(value?: string) {
  if (value === "ELIGIBLE" || value === "PASSED" || value === "VALID" || value === "LINKED")
    return "확인 완료";
  if (value === "INELIGIBLE" || value === "FAILED") return "거절";
  if (value === "EXPIRED") return "유효기간 만료";
  return value ?? "확인 중";
}

export function InvestorOnboarding() {
  const [profile, setProfile] = useState<DemoProfile>("investorA");
  const [step, setStep] = useState(0);
  const [session, setSession] = useState<Session>();
  const [disclosure, setDisclosure] = useState<Disclosure>();
  const [consent, setConsent] = useState<Consent>();
  const [answers, setAnswers] = useState(() => quizItems.map(() => false));
  const [message, setMessage] = useState("합성 고객 판정을 불러오는 중이다.");
  const scenario = scenarios[profile];
  const token = demoTokens[profile];

  useEffect(() => {
    const saved = sessionStorage.getItem("rwa-onboarding");
    if (saved) {
      try {
        const state = JSON.parse(saved) as { profile?: DemoProfile; step?: number };
        if (state.profile && state.profile in scenarios) setProfile(state.profile);
        if (
          Number.isInteger(state.step) &&
          Number(state.step) >= 0 &&
          Number(state.step) < steps.length
        )
          setStep(Number(state.step));
      } catch {
        sessionStorage.removeItem("rwa-onboarding");
      }
    }
  }, []);

  useEffect(() => {
    sessionStorage.setItem("rwa-onboarding", JSON.stringify({ profile, step }));
  }, [profile, step]);

  useEffect(() => {
    let cancelled = false;
    setSession(undefined);
    setConsent(undefined);
    setMessage("합성 고객 판정을 불러오는 중이다.");
    void Promise.all([
      platformFetch<Session>("/session", { token }),
      platformFetch<Disclosure>("/disclosures/current"),
      platformFetch<Consent>("/disclosure-consents/current", { token }),
    ])
      .then(([nextSession, nextDisclosure, nextConsent]) => {
        if (cancelled) return;
        setSession(nextSession);
        setDisclosure(nextDisclosure);
        setConsent(nextConsent);
        setMessage("인가 해외 증권사의 모의 고객 판정을 확인했다.");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setMessage(error instanceof Error ? error.message : "합성 판정을 불러오지 못했다.");
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const readiness = session?.customerReadiness;
  const eligible = readiness?.eligibility === "ELIGIBLE";
  const allAnswersConfirmed = answers.every(Boolean);
  const outcome = useMemo(() => {
    if (readiness?.eligibility === "INELIGIBLE") {
      return {
        kind: "blocked",
        title: "계좌 개설을 진행할 수 없다",
        body: "판매 가능 판정이 거절돼 주문과 권리 수령이 차단된다. 인가 해외 증권사가 판정 근거와 재심사 가능 여부를 안내한다.",
      };
    }
    if (readiness?.eligibility === "EXPIRED" || readiness?.investorProtection === "EXPIRED") {
      return {
        kind: "blocked",
        title: "고객확인 재실사가 필요하다",
        body: "고객확인 또는 투자자 보호 판정의 유효기간이 끝났다. 갱신 전에는 주문과 권리 수령이 차단된다.",
      };
    }
    if (readiness?.eligibility === "ELIGIBLE" && readiness?.investorProtection === "PASSED") {
      return {
        kind: "approved",
        title: "모의 계좌 준비가 완료됐다",
        body: "고객확인, 투자자 보호, 위험공시와 전용 지갑 상태를 확인했다. 투자자 업무공간에서 전체 생애주기를 이어서 볼 수 있다.",
      };
    }
    return {
      kind: "pending",
      title: "기관 확인이 아직 끝나지 않았다",
      body: "인가 해외 증권사의 모의 판정 응답을 다시 확인한다.",
    };
  }, [readiness]);

  function next() {
    setStep((current) => Math.min(current + 1, steps.length - 1));
  }

  function previous() {
    setStep((current) => Math.max(current - 1, 0));
  }

  function reset() {
    sessionStorage.removeItem("rwa-onboarding");
    setProfile("investorA");
    setStep(0);
    setAnswers(quizItems.map(() => false));
    setMessage("브라우저의 온보딩 진행상태만 초기화했다. 거래 데이터는 변경하지 않았다.");
  }

  function changeScenario(nextProfile: DemoProfile) {
    setProfile(nextProfile);
    setStep(0);
    setAnswers(quizItems.map(() => false));
  }

  return (
    <div className="onboardingContent">
      <section className="onboardingHero">
        <div>
          <p className="eyebrow">SYNTHETIC INVESTOR ONBOARDING</p>
          <h1>모의 한국주식 계좌 개설</h1>
          <p>
            거래소형 고객 준비 과정을 재현하지만 실제 계좌, 개인정보, 여권 파일이나 자금은 만들지
            않는다.
          </p>
        </div>
        <button className="subtleButton" type="button" onClick={reset}>
          온보딩 다시 시작
        </button>
      </section>

      <div className="onboardingNotice" role="status">
        <strong>모의 온보딩이며 실제 계좌가 개설되지 않는다.</strong>
        <span>{message}</span>
      </div>

      <ol className="onboardingProgress" aria-label="모의 계좌 개설 단계">
        {steps.map((label, index) => (
          <li key={label} className={index === step ? "current" : index < step ? "complete" : ""}>
            <span>{index < step ? "✓" : index + 1}</span>
            <small>{label}</small>
          </li>
        ))}
      </ol>

      <section className="onboardingPanel">
        {step === 0 && (
          <>
            <p className="eyebrow">STEP 01</p>
            <h2>모의 계좌 개설 시작</h2>
            <p className="onboardingCopy">
              비거주 일반 개인투자자가 인가 해외 증권사를 통해 한국주식 수탁권리에 접근하는 상황을
              재현한다. 아래 값은 모두 시연을 위해 고정한 합성 정보다.
            </p>
            <div className="syntheticSummary">
              <div>
                <span>고객 참조</span>
                <strong>{scenario.customerReference}</strong>
              </div>
              <div>
                <span>투자자 유형</span>
                <strong>해외 일반 개인투자자</strong>
              </div>
              <div>
                <span>판매 관할</span>
                <strong>{scenario.residence}</strong>
              </div>
              <div>
                <span>예정 자금경로</span>
                <strong>{scenario.funding}</strong>
              </div>
            </div>
            <details className="reviewerSettings">
              <summary>검토자 설정: 다른 심사 결과 선택</summary>
              <label>
                시연 시나리오
                <select
                  value={profile}
                  onChange={(event) => changeScenario(event.target.value as DemoProfile)}
                >
                  {Object.entries(scenarios).map(([value, item]) => (
                    <option value={value} key={value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <p>{scenario.description}</p>
            </details>
            <button type="button" onClick={next}>
              모의 계좌 개설 시작
            </button>
          </>
        )}

        {step === 1 && (
          <>
            <p className="eyebrow">STEP 02</p>
            <h2>합성 여권 제출</h2>
            <p className="onboardingCopy">
              실제 파일을 선택하거나 전송하지 않는다. 아래 카드는 화면 시연용으로 만든 가짜 문서다.
            </p>
            <div className="syntheticPassport" aria-label="합성 여권 미리보기">
              <div className="passportHeader">
                <strong>SIMULATION PASSPORT</strong>
                <span>NOT A REAL DOCUMENT</span>
              </div>
              <div className="passportBody">
                <div className="passportPhoto" aria-hidden="true">
                  SIM
                </div>
                <dl>
                  <div>
                    <dt>문서 표식</dt>
                    <dd>{scenario.passportMark}</dd>
                  </div>
                  <div>
                    <dt>성명</dt>
                    <dd>합성 고객 ••••</dd>
                  </div>
                  <div>
                    <dt>생년월일</dt>
                    <dd>••••-••-••</dd>
                  </div>
                  <div>
                    <dt>국적</dt>
                    <dd>공유 화면 미표시</dd>
                  </div>
                </dl>
              </div>
              <code>P&lt;SIMULATION&lt;&lt;NO&lt;PERSONAL&lt;DATA&lt;&lt;&lt;&lt;&lt;</code>
            </div>
            <p className="privacyBoundary">
              파일 입력 없음 · OCR 없음 · 서버 전송 없음 · 실제 개인정보 저장 없음
            </p>
            <div className="onboardingActions">
              <button className="subtleButton" type="button" onClick={previous}>
                이전
              </button>
              <button type="button" onClick={next}>
                합성 여권 제출
              </button>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <p className="eyebrow">STEP 03</p>
            <h2>고객확인과 판매 가능 판정</h2>
            <p className="onboardingCopy">
              인가 해외 증권사가 반환한 합성 결과를 표시한다. 제재조회 원문이나 개인정보는 플랫폼에
              표시하지 않는다.
            </p>
            <div className="checkResultList">
              <div>
                <span>신원확인</span>
                <strong>{statusLabel(readiness?.eligibility)}</strong>
              </div>
              <div>
                <span>제재 확인</span>
                <strong>
                  {readiness?.eligibility === "ELIGIBLE" ? "이상 없음" : "기관 검토 필요"}
                </strong>
              </div>
              <div>
                <span>판매 가능 판정</span>
                <strong>{statusLabel(readiness?.eligibility)}</strong>
              </div>
              <div>
                <span>책임기관</span>
                <strong>인가 해외 증권사</strong>
              </div>
            </div>
            <div className="onboardingActions">
              <button className="subtleButton" type="button" onClick={previous}>
                이전
              </button>
              <button type="button" disabled={!session} onClick={next}>
                판정 확인
              </button>
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <p className="eyebrow">STEP 04</p>
            <h2>투자자 보호 문답</h2>
            <p className="onboardingCopy">
              실제 적합성 심사가 아니라, 수탁권리토큰의 핵심 구조를 이해했는지 확인하는 합성
              문답이다.
            </p>
            <div className="quizList">
              {quizItems.map((item, index) => (
                <label key={item}>
                  <input
                    type="checkbox"
                    checked={answers[index]}
                    onChange={(event) =>
                      setAnswers((current) =>
                        current.map((value, itemIndex) =>
                          itemIndex === index ? event.target.checked : value,
                        ),
                      )
                    }
                  />
                  <span>{item}</span>
                </label>
              ))}
            </div>
            <p className="privacyBoundary">
              합성 판정 결과: {statusLabel(readiness?.investorProtection)}
            </p>
            <div className="onboardingActions">
              <button className="subtleButton" type="button" onClick={previous}>
                이전
              </button>
              <button type="button" disabled={!allAnswersConfirmed} onClick={next}>
                문답 확인
              </button>
            </div>
          </>
        )}

        {step === 4 && (
          <>
            <p className="eyebrow">STEP 05</p>
            <h2>{disclosure?.titleKo ?? "위험공시 불러오는 중"}</h2>
            <div className="disclosureList onboardingDisclosure">
              {disclosure?.sections.map((section) => (
                <details key={section.code} open>
                  <summary>{section.titleKo}</summary>
                  <p>{section.summaryKo}</p>
                </details>
              ))}
            </div>
            <p className="privacyBoundary">현재 동의 상태: {statusLabel(consent?.status)}</p>
            <div className="onboardingActions">
              <button className="subtleButton" type="button" onClick={previous}>
                이전
              </button>
              <button type="button" disabled={!disclosure} onClick={next}>
                위험공시 확인 및 계속
              </button>
            </div>
          </>
        )}

        {step === 5 && (
          <>
            <p className="eyebrow">STEP 06</p>
            <h2>전용 자기보관 지갑 확인</h2>
            <p className="onboardingCopy">
              주문 의사는 고객 지갑에서 서명하지만 고객별 수탁권리의 기준 기록은 인가 해외 증권사의
              원장이다. 플랫폼은 개인키를 보관하지 않는다.
            </p>
            <div className="walletVerification">
              <span>지갑 연결 상태</span>
              <strong>{statusLabel(readiness?.wallet)}</strong>
              {readiness?.activeWallet ? (
                <code>{readiness.activeWallet}</code>
              ) : (
                <p>판매 가능 판정이 완료돼야 지갑 연결을 진행할 수 있다.</p>
              )}
            </div>
            <div className="onboardingActions">
              <button className="subtleButton" type="button" onClick={previous}>
                이전
              </button>
              <button type="button" disabled={!session} onClick={next}>
                {eligible ? "전용 지갑 확인" : "심사 결과 보기"}
              </button>
            </div>
          </>
        )}

        {step === 6 && (
          <>
            <p className="eyebrow">STEP 07</p>
            <div className={`onboardingOutcome ${outcome.kind}`}>
              <span>
                {outcome.kind === "approved"
                  ? "승인"
                  : outcome.kind === "blocked"
                    ? "차단"
                    : "대기"}
              </span>
              <h2>{outcome.title}</h2>
              <p>{outcome.body}</p>
            </div>
            <div className="resultFacts">
              <div>
                <span>고객확인</span>
                <strong>{statusLabel(readiness?.eligibility)}</strong>
              </div>
              <div>
                <span>투자자 보호</span>
                <strong>{statusLabel(readiness?.investorProtection)}</strong>
              </div>
              <div>
                <span>위험공시</span>
                <strong>{statusLabel(consent?.status)}</strong>
              </div>
              <div>
                <span>전용 지갑</span>
                <strong>{statusLabel(readiness?.wallet)}</strong>
              </div>
            </div>
            <div className="onboardingActions resultActions">
              <button className="subtleButton" type="button" onClick={reset}>
                다른 시나리오 확인
              </button>
              {outcome.kind === "approved" ? (
                <Link
                  className="primaryLink"
                  href={`/investor?profile=${profile}&onboarding=complete`}
                >
                  투자자 업무공간으로 이동
                </Link>
              ) : (
                <Link
                  className="primaryLink"
                  href={`/investor?profile=${profile}&onboarding=blocked`}
                >
                  차단 사유 자세히 보기
                </Link>
              )}
            </div>
          </>
        )}
      </section>

      <p className="onboardingBoundary">
        합성 여권과 문답은 화면 흐름을 설명하기 위한 브라우저 표시다. 법적 고객확인, 실제 계좌 개설,
        개인정보 처리나 판매 승인을 수행하지 않는다.
      </p>
    </div>
  );
}
