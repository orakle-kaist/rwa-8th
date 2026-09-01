"use client";

import { keccak256, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  allProducts,
  demoProducts,
  demoTokens,
  platformFetch,
  type Activity,
  type Complaint,
  type DemoProfile,
  type Position,
  type PrimaryOrder,
  type Product,
  type Redemption,
  type SecondaryOrder,
  type SecondaryQuote,
  type Session,
  type WorkflowTimeline,
} from "../lib/platform-api";

export type InvestorScreen =
  | "home"
  | "market"
  | "product"
  | "primary"
  | "order"
  | "positions"
  | "secondary"
  | "activities"
  | "rights"
  | "support";

const profileLabels: Record<DemoProfile, string> = {
  investorA: "허용 고객 A",
  investorB: "허용 고객 B",
  denied: "거절 고객",
  expired: "만료 고객",
};

const navigation = [
  ["home", "홈", "/investor"],
  ["market", "시장", "/investor/markets"],
  ["positions", "보유", "/investor/positions"],
  ["activities", "주문·활동", "/investor/activities"],
  ["rights", "권리", "/investor/rights"],
  ["support", "지원", "/investor/support"],
] as const;

function withProfile(path: string, profile: DemoProfile) {
  return `${path}${path.includes("?") ? "&" : "?"}profile=${profile}`;
}

function money(minor: string | undefined, decimals = 2) {
  if (!minor) return "-";
  return (Number(minor) / 10 ** decimals).toLocaleString("ko-KR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function shortId(value: string | undefined) {
  return value ? `${value.slice(0, 8)}…${value.slice(-4)}` : "-";
}

function koreanStatus(code: string | undefined) {
  const labels: Record<string, string> = {
    ACCEPTED: "접수",
    PENDING: "대기",
    COMPLETED: "완료",
    TRADABLE: "거래 가능",
    SETTLEMENT_PENDING: "국내 결제 대기",
    QUARANTINED: "격리",
    CANCELLED: "취소",
    REDEMPTION_CANCELLED: "환매 취소",
    VALID: "유효",
    MISSING: "필요",
    EXPIRED: "만료",
  };
  return code ? (labels[code] ?? code.replaceAll("_", " ")) : "확인 중";
}

interface JourneyData {
  session: Session | undefined;
  demoProduct: Product | undefined;
  candidates: Product[];
  positions: Position[];
  activities: Activity[];
  primaryOrders: PrimaryOrder[];
  secondaryOrders: SecondaryOrder[];
  quotes: SecondaryQuote[];
  redemptions: Redemption[];
  complaints: Complaint[];
}

export function InvestorJourney({
  initialProfile,
  screen,
  workflowId,
  autoOpenBackstage = false,
}: {
  initialProfile: DemoProfile;
  screen: InvestorScreen;
  workflowId?: string;
  autoOpenBackstage?: boolean;
}) {
  const router = useRouter();
  const [profile, setProfile] = useState(initialProfile);
  const [data, setData] = useState<JourneyData>({
    session: undefined,
    demoProduct: undefined,
    candidates: [],
    positions: [],
    activities: [],
    primaryOrders: [],
    secondaryOrders: [],
    quotes: [],
    redemptions: [],
    complaints: [],
  });
  const [message, setMessage] = useState("투자자 여정을 불러오는 중이다.");
  const [backstageId, setBackstageId] = useState<string | undefined>(
    autoOpenBackstage ? workflowId : undefined,
  );
  const [confirmingPrimary, setConfirmingPrimary] = useState(false);
  const refreshIndex = useRef(0);
  const token = demoTokens[profile];
  const account = useMemo(
    () =>
      profile === "investorB"
        ? privateKeyToAccount(keccak256(toHex("PRIMARY-DEMO-B")))
        : privateKeyToAccount(keccak256(toHex("PRIMARY-DEMO-A"))),
    [profile],
  );

  const refresh = useCallback(async () => {
    const index = ++refreshIndex.current;
    try {
      const [session, demos, candidates, positions, activities, primary, secondary, redemption, complaints] =
        await Promise.all([
          platformFetch<Session>("/session", { token }),
          demoProducts(),
          allProducts(),
          platformFetch<{ items: Position[] }>("/positions?limit=100", { token }),
          platformFetch<{ items: Activity[] }>("/activities?limit=100", { token }),
          platformFetch<{ items: PrimaryOrder[] }>("/primary-orders", { token }),
          platformFetch<{ items: SecondaryOrder[] }>("/secondary-orders", { token }),
          platformFetch<{ items: Redemption[] }>("/redemptions", { token }),
          platformFetch<{ items: Complaint[] }>("/complaints", { token }),
        ]);
      const quotePages = await Promise.all(
        (["USD_LEDGER", "USDC_ONCHAIN"] as const).flatMap((fundingMode) =>
          (["BUY", "SELL"] as const).map((side) =>
            platformFetch<{ items: SecondaryQuote[] }>(
              `/quotes?securityId=990001&investorSide=${side}&fundingMode=${fundingMode}`,
            ),
          ),
        ),
      );
      if (index !== refreshIndex.current) return;
      setData({
        session,
        demoProduct: demos.find((item) => item.securityId === "990001"),
        candidates,
        positions: positions.items,
        activities: activities.items,
        primaryOrders: primary.items,
        secondaryOrders: secondary.items,
        quotes: quotePages.flatMap((page) => page.items),
        redemptions: redemption.items,
        complaints: complaints.items,
      });
      setMessage("같은 업무 ID로 권리·토큰·자금과 기관 처리를 연결했다.");
    } catch (error) {
      if (index !== refreshIndex.current) return;
      setMessage(error instanceof Error ? error.message : "조회에 실패했다.");
    }
  }, [token]);

  useEffect(() => void refresh(), [refresh]);

  const journey = data.session?.localInvestorJourney;
  const readiness = data.session?.customerReadiness;
  const position = data.positions.find((item) => item.securityId === "990001");
  const latestPrimary = data.primaryOrders[0];
  const latestSecondary = data.secondaryOrders[0];
  const latestRedemption = data.redemptions[0];

  async function submitPrimary(formData: FormData) {
    const scenario = journey?.primary;
    if (!scenario) return;
    try {
      const quantity = String(formData.get("quantity") ?? "1");
      const fundingMode = String(formData.get("fundingMode") ?? "USD");
      const orderId = crypto.randomUUID();
      const fundingAmountMinor = (
        (BigInt(quantity) * BigInt(scenario.referenceLimitKrw) * 1000n + 13802n) /
        13803n
      ).toString();
      const expiresAt = String(Math.floor(Date.now() / 1000) + 3600);
      const message = {
        orderId,
        investor: account.address,
        securityId: "990001",
        shareQuantity: quantity,
        krwLimitPrice: "257000",
        targetTradingDate: "2026-08-31",
        fundingMode,
        fundingAmountMinor,
        nonce: String(Date.now()),
        expiresAt,
        policyVersion: keccak256(toHex(scenario.policyVersion)),
      };
      const signature = await account.signTypedData({
        domain: scenario.intentDomain,
        types: {
          PrimaryOrderIntent: [
            { name: "orderId", type: "bytes16" },
            { name: "investor", type: "address" },
            { name: "securityId", type: "string" },
            { name: "shareQuantity", type: "uint256" },
            { name: "krwLimitPrice", type: "uint256" },
            { name: "targetTradingDate", type: "string" },
            { name: "fundingMode", type: "string" },
            { name: "fundingAmountMinor", type: "uint256" },
            { name: "nonce", type: "uint256" },
            { name: "expiresAt", type: "uint256" },
            { name: "policyVersion", type: "bytes32" },
          ],
        },
        primaryType: "PrimaryOrderIntent",
        message: {
          ...message,
          orderId: `0x${orderId.replaceAll("-", "")}` as `0x${string}`,
          shareQuantity: BigInt(quantity),
          krwLimitPrice: 257000n,
          fundingAmountMinor: BigInt(fundingAmountMinor),
          nonce: BigInt(message.nonce),
          expiresAt: BigInt(expiresAt),
        },
      });
      const accepted = await platformFetch<{ workflowId: string }>("/primary-orders", {
        token,
        method: "POST",
        body: {
          securityId: "990001",
          shareQuantity: quantity,
          krwLimitPrice: "257000",
          targetTradingDate: "2026-08-31",
          fundingMode,
          signedIntent: {
            domain: scenario.intentDomain,
            primaryType: "PrimaryOrderIntent",
            message,
            signer: account.address,
            signature,
          },
        },
      });
      router.push(withProfile(`/investor/orders/${accepted.workflowId}?backstage=1`, profile));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "1차 주문 접수에 실패했다.");
    }
  }

  async function submitSecondary(formData: FormData) {
    const scenario = journey?.secondary;
    const quote = data.quotes.find((item) => item.quoteId === String(formData.get("quoteId")));
    if (!scenario || !quote) return setMessage("유효한 지정 시장조성자 호가를 선택한다.");
    try {
      const quantity = String(formData.get("quantity") ?? "1");
      const orderId = crypto.randomUUID();
      const paymentAmountMinor = (BigInt(quote.unitPrice.amountMinor) * BigInt(quantity)).toString();
      const expiresAt = String(Math.floor(new Date(quote.expiresAt).getTime() / 1000));
      const message = {
        orderId,
        quoteId: quote.quoteId,
        investor: account.address,
        token: quote.tokenAddress,
        investorSide: quote.investorSide,
        paymentMode: quote.fundingMode,
        paymentAssetId: quote.paymentAssetId,
        shareQuantity: quantity,
        paymentAmountMinor,
        nonce: String(Date.now()),
        expiresAt,
        policyVersion: keccak256(toHex(scenario.policyVersion)),
      };
      const signature = await account.signTypedData({
        domain: scenario.intentDomain,
        types: {
          SecondaryOrderIntent: [
            { name: "orderId", type: "bytes16" },
            { name: "quoteId", type: "bytes16" },
            { name: "investor", type: "address" },
            { name: "token", type: "address" },
            { name: "investorSide", type: "string" },
            { name: "paymentMode", type: "string" },
            { name: "paymentAssetId", type: "bytes32" },
            { name: "shareQuantity", type: "uint256" },
            { name: "paymentAmountMinor", type: "uint256" },
            { name: "nonce", type: "uint256" },
            { name: "expiresAt", type: "uint256" },
            { name: "policyVersion", type: "bytes32" },
          ],
        },
        primaryType: "SecondaryOrderIntent",
        message: {
          ...message,
          orderId: `0x${orderId.replaceAll("-", "")}` as `0x${string}`,
          quoteId: `0x${quote.quoteId.replaceAll("-", "")}` as `0x${string}`,
          shareQuantity: BigInt(quantity),
          paymentAmountMinor: BigInt(paymentAmountMinor),
          nonce: BigInt(message.nonce),
          expiresAt: BigInt(expiresAt),
        },
      });
      const accepted = await platformFetch<{ workflowId: string }>("/secondary-orders", {
        token,
        method: "POST",
        body: {
          quoteId: quote.quoteId,
          shareQuantity: quantity,
          investorSide: quote.investorSide,
          fundingMode: quote.fundingMode,
          signedIntent: {
            domain: scenario.intentDomain,
            primaryType: "SecondaryOrderIntent",
            message,
            signer: account.address,
            signature,
          },
        },
      });
      router.push(withProfile(`/investor/orders/${accepted.workflowId}?backstage=1`, profile));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "24/7 제한 거래 주문에 실패했다.");
    }
  }

  async function submitRedemption(formData: FormData) {
    const scenario = journey?.redemption;
    if (!scenario) return;
    try {
      const quantity = String(formData.get("quantity") ?? "1");
      const redemptionId = crypto.randomUUID();
      const expiresAt = String(Math.floor(Date.now() / 1000) + 3600);
      const message = {
        redemptionId,
        investor: account.address,
        token: scenario.tokenAddress,
        shareQuantity: quantity,
        krwLimitPrice: "257000",
        targetTradingDate: "2026-08-31",
        nonce: String(Date.now()),
        expiresAt,
        policyVersion: keccak256(toHex(scenario.policyVersion)),
      };
      const signature = await account.signTypedData({
        domain: scenario.intentDomain,
        types: {
          RedemptionIntent: [
            { name: "redemptionId", type: "bytes16" },
            { name: "investor", type: "address" },
            { name: "token", type: "address" },
            { name: "shareQuantity", type: "uint256" },
            { name: "krwLimitPrice", type: "uint256" },
            { name: "targetTradingDate", type: "string" },
            { name: "nonce", type: "uint256" },
            { name: "expiresAt", type: "uint256" },
            { name: "policyVersion", type: "bytes32" },
          ],
        },
        primaryType: "RedemptionIntent",
        message: {
          ...message,
          redemptionId: `0x${redemptionId.replaceAll("-", "")}` as `0x${string}`,
          shareQuantity: BigInt(quantity),
          krwLimitPrice: 257000n,
          nonce: BigInt(message.nonce),
          expiresAt: BigInt(expiresAt),
        },
      });
      const accepted = await platformFetch<{ workflowId: string }>("/redemptions", {
        token,
        method: "POST",
        body: {
          securityId: "990001",
          shareQuantity: quantity,
          krwLimitPrice: "257000",
          targetTradingDate: "2026-08-31",
          signedIntent: {
            domain: scenario.intentDomain,
            primaryType: "RedemptionIntent",
            message,
            signer: account.address,
            signature,
          },
        },
      });
      router.push(withProfile(`/investor/orders/${accepted.workflowId}?backstage=1`, profile));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "환매 요청에 실패했다.");
    }
  }

  async function convertDividend() {
    const dividend = journey?.rights?.dividend;
    if (!dividend?.paymentId || !dividend.quoteId) return;
    await platformFetch("/dividend-conversions", {
      token,
      method: "POST",
      body: { dividendPaymentId: dividend.paymentId, quoteId: dividend.quoteId },
    });
    setMessage("배당 USD의 모의 USDC 전환을 접수했다.");
    await refresh();
  }

  async function submitVote(instruction: "FOR" | "AGAINST" | "ABSTAIN") {
    const voting = journey?.rights?.voting;
    if (!voting) return;
    await platformFetch("/voting-instructions", {
      token,
      method: "POST",
      body: { meetingId: voting.meetingId, agendaId: voting.agendaId, instruction },
    });
    setMessage("의결권 지시를 접수했다. 미응답 수량은 행사하지 않는다.");
    await refresh();
  }

  async function submitComplaint(formData: FormData) {
    await platformFetch("/complaints", {
      token,
      method: "POST",
      body: {
        type: String(formData.get("type")),
        titleKo: String(formData.get("titleKo")),
        descriptionKo: String(formData.get("descriptionKo")),
        disclosureVersion: "SIM-RISK-2",
      },
    });
    setMessage("민원을 접수했다. 유형에 따라 책임기관을 배정한다.");
    await refresh();
  }

  return (
    <main className="investorAppShell">
      <header className="investorTopbar">
        <Link className="investorBrand" href="/">K-EQUITY</Link>
        <nav aria-label="투자자 메뉴">
          {navigation.map(([key, label, path]) => (
            <Link
              key={key}
              aria-current={screen === key ? "page" : undefined}
              href={withProfile(path, profile)}
            >
              {label}
            </Link>
          ))}
        </nav>
        <span className="simulationBadge">모의·실제 거래 아님</span>
      </header>

      <div className="investorPage">
        <div className="journeyNotice" role="status">
          <span>{message}</span>
          <button type="button" className="textButton" onClick={() => void refresh()}>새로고침</button>
        </div>

        {screen === "home" ? (
          <HomeScreen
            profile={profile}
            setProfile={setProfile}
            readiness={readiness}
            journey={journey}
            position={position}
            latestPrimary={latestPrimary}
          />
        ) : null}
        {screen === "market" ? (
          <MarketScreen profile={profile} demo={data.demoProduct} candidates={data.candidates} />
        ) : null}
        {screen === "product" ? (
          <ProductScreen profile={profile} product={data.demoProduct} journey={journey} />
        ) : null}
        {screen === "primary" ? (
          <PrimaryScreen
            journey={journey}
            readiness={readiness}
            confirming={confirmingPrimary}
            setConfirming={setConfirmingPrimary}
            submit={submitPrimary}
          />
        ) : null}
        {screen === "order" && workflowId ? (
          <OrderScreen
            workflowId={workflowId}
            token={token}
            primary={data.primaryOrders.find((item) => item.orderId === workflowId)}
            secondary={data.secondaryOrders.find((item) => item.orderId === workflowId)}
            redemption={data.redemptions.find((item) => item.redemptionId === workflowId)}
            openBackstage={() => setBackstageId(workflowId)}
          />
        ) : null}
        {screen === "positions" ? (
          <PositionsScreen profile={profile} position={position} journey={journey} />
        ) : null}
        {screen === "secondary" ? (
          <SecondaryScreen
            journey={journey}
            quotes={data.quotes}
            position={position}
            readiness={readiness}
            submit={submitSecondary}
          />
        ) : null}
        {screen === "activities" ? (
          <ActivitiesScreen profile={profile} activities={data.activities} openBackstage={setBackstageId} />
        ) : null}
        {screen === "rights" ? (
          <RightsScreen
            journey={journey}
            profile={profile}
            submitRedemption={submitRedemption}
            convertDividend={convertDividend}
            submitVote={submitVote}
          />
        ) : null}
        {screen === "support" ? (
          <SupportScreen complaints={data.complaints} submit={submitComplaint} />
        ) : null}
      </div>

      <WorkflowBackstage
        workflowId={backstageId}
        token={token}
        close={() => setBackstageId(undefined)}
      />
    </main>
  );
}

function PageHeading({ eyebrow, title, children }: { eyebrow: string; title: string; children: React.ReactNode }) {
  return <header className="pageHeading"><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{children}</p></header>;
}

function HomeScreen({ profile, setProfile, readiness, journey, position, latestPrimary }: {
  profile: DemoProfile;
  setProfile: (profile: DemoProfile) => void;
  readiness?: Session["customerReadiness"];
  journey?: Session["localInvestorJourney"];
  position: Position | undefined;
  latestPrimary: PrimaryOrder | undefined;
}) {
  const ready = readiness?.canPlaceNewOrder;
  const nextPath = ready ? "/investor/markets" : "/investor/onboarding";
  return <>
    <PageHeading eyebrow="INVESTOR HOME" title="안녕하세요, 모의 투자자님">고객이 보는 투자 경험과 기관의 수탁·토큰 처리를 같은 업무로 연결한다.</PageHeading>
    <section className="nextTaskCard">
      <div><span>다음 할 일</span><h2>{ready ? "모의 삼성전자 상품 살펴보기" : "계좌 개설 절차 완료하기"}</h2><p>{ready ? "KRX 1차 주문과 결제완료 권리의 24/7 거래를 구분해 확인한다." : "고객확인·위험공시·전용 지갑 상태를 먼저 확인한다."}</p></div>
      <Link className="primaryLink" href={withProfile(nextPath, profile)}>{ready ? "시장으로 이동" : "온보딩 계속"}</Link>
    </section>
    <section className="accountSummary" aria-label="계좌 요약">
      <div><span>사용 가능 USD</span><strong>${money(journey?.primary?.cash?.usdAvailableMinor)}</strong></div>
      <div><span>사용 가능 USDC</span><strong>{money(journey?.primary?.cash?.usdcAvailableMinor, 6)}</strong></div>
      <div><span>결제완료 권리</span><strong>{position?.settledRights ?? "0"}주</strong></div>
      <div><span>진행 중 주문</span><strong>{latestPrimary ? "1건" : "0건"}</strong></div>
    </section>
    <section className="journeyOverview">
      <h2>한 종목으로 따라가는 전체 여정</h2>
      <ol>
        {["KRX 1차 주문", "체결 후 권리기입·선발행", "T+2 거래 가능 전환", "지정 MM과 24/7 제한 거래", "환매·배당·의결권"].map((label, index) => <li key={label}><span>{index + 1}</span>{label}</li>)}
      </ol>
      <p>24/7은 KRX가 24시간 거래된다는 뜻이 아니다. 국내 통합 보유총량을 바꾸지 않고 결제완료 수탁권리를 투자자와 지정 시장조성자 사이에서 재배분한다.</p>
    </section>
    <details className="reviewMode"><summary>검토 모드</summary><label>합성 고객 시나리오<select value={profile} onChange={(event) => setProfile(event.target.value as DemoProfile)}>{Object.entries(profileLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><div className="buttonRow"><Link href="/investor/onboarding">온보딩 다시 시작</Link><Link href={withProfile("/investor/reviewer", profile)}>내부 시험 제어 열기</Link></div></details>
  </>;
}

function MarketScreen({ profile, demo, candidates }: { profile: DemoProfile; demo: Product | undefined; candidates: Product[] }) {
  const [query, setQuery] = useState("");
  const visible = candidates.filter((item) => `${item.securityId} ${item.nameKo}`.toLowerCase().includes(query.toLowerCase())).slice(0, 18);
  return <>
    <PageHeading eyebrow="MARKET" title="시장">실제 시연 상품과 아직 활성화하지 않은 KOSPI 200 후보를 명확히 구분한다.</PageHeading>
    <section className="demoProductCard"><div><span className="statePill">PoC 시연 상품</span><h2>{demo?.nameKo ?? "모의 삼성전자 수탁권리"}</h2><p>기초종목 삼성전자(005930) · 1주 = 수탁권리 1단위 = 토큰 1단위</p></div><div className="marketPrice"><span>KRX 기준</span><strong>257,000원</strong><small>USD 참고 $186.19</small></div><Link className="primaryLink" href={withProfile("/investor/products/990001", profile)}>상품 상세</Link></section>
    <section className="candidateSection"><div className="sectionTitle"><div><h2>KOSPI 200 후보</h2><p>공식 ISIN·수탁지원·판매정책 확인 전에는 주문할 수 없다.</p></div><input aria-label="후보 검색" placeholder="종목명 또는 코드" value={query} onChange={(event) => setQuery(event.target.value)} /></div><div className="candidateTable"><div className="candidateRow header"><span>종목</span><span>구분</span><span>상태</span></div>{visible.map((item) => <div className="candidateRow" key={item.securityId}><strong>{item.nameKo}<small>{item.securityId}</small></strong><span>{item.representative ? "대표 검증종목" : "KOSPI 200"}</span><em>비활성</em></div>)}</div></section>
  </>;
}

function ProductScreen({ profile, product, journey }: { profile: DemoProfile; product: Product | undefined; journey?: Session["localInvestorJourney"] }) {
  return <>
    <PageHeading eyebrow="PRODUCT" title={product?.nameKo ?? "모의 삼성전자 수탁권리"}>기초주식을 직접 보유하는 상품이 아니라 인가 해외 증권사가 기록하는 고객별 수탁권리를 제한형 토큰으로 표시한다.</PageHeading>
    <section className="productHero"><div className="marketPrice"><span>KRX 마지막 기준가격</span><strong>257,000원</strong><small>2026-08-28 · USD/KRW 1,380.3</small></div><div className="quotePair"><div><span>지정 MM 매수</span><strong>${money(journey?.normalBidUsdMinor)}</strong></div><div><span>지정 MM 매도</span><strong>${money(journey?.normalAskUsdMinor)}</strong></div></div></section>
    <section className="productActions"><article><span>토큰 1차시장</span><h2>KRX 1차 주문</h2><p>해외 증권사가 주문을 취합해 국내 증권사에 전달한다. 체결 후 권리와 결제 대기 토큰을 먼저 만들고 T+2까지 거래를 잠근다.</p><Link className="primaryLink" href={withProfile("/investor/orders/new", profile)}>1차 주문</Link></article><article><span>토큰 2차시장</span><h2>24/7 권리 거래</h2><p>이미 국내 결제가 끝난 권리만 지정 시장조성자와 거래한다. 국내 통합계좌 총보유량은 변하지 않는다.</p><Link className="primaryLink" href={withProfile("/investor/secondary", profile)}>24/7 거래</Link></article></section>
    <section className="disclosureFacts"><h2>권리와 책임 구조</h2><dl><div><dt>고객 권리 기준기록</dt><dd>인가 해외 증권사의 고객별 수탁권리 원장</dd></div><div><dt>국내 보유</dt><dd>외국인 통합계좌의 국내 결제완료 총보유량</dd></div><div><dt>토큰</dt><dd>발행·이전·잠금·소각 실행 기록이며 기준장부가 아님</dd></div><div><dt>이전</dt><dd>적격 투자자와 지정 MM 사이의 승인된 정산만 허용</dd></div><div><dt>배당·의결권</dt><dd>기준일 권리 스냅샷과 해외 증권사 승인으로 처리</dd></div><div><dt>환매</dt><dd>KRX 매도와 T+2 후 권리종료·USD 지급·토큰 소각</dd></div></dl></section>
  </>;
}

function PrimaryScreen({ journey, readiness, confirming, setConfirming, submit }: { journey?: Session["localInvestorJourney"]; readiness?: Session["customerReadiness"]; confirming: boolean; setConfirming: (value: boolean) => void; submit: (data: FormData) => Promise<void> }) {
  const [quantity, setQuantity] = useState("1");
  const [funding, setFunding] = useState("USD_LEDGER");
  const estimated = Number(quantity || 0) * 186.19;
  return <>
    <PageHeading eyebrow="PRIMARY ORDER" title="KRX 1차 주문">정수 수량의 KRW 지정가 주문만 지원하며 기초주식 체결 후 수탁권리와 토큰이 생성된다.</PageHeading>
    <form action={submit} className="orderTicket"><div className="orderInstrument"><div><span>모의 삼성전자 수탁권리</span><strong>257,000원</strong></div><small>지정가 · 해당 KRX 영업일 당일 유효</small></div><label>주문수량<input name="quantity" type="number" min="1" step="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} /></label><label>결제 경로<select name="fundingMode" value={funding} onChange={(event) => setFunding(event.target.value)}><option value="USD_LEDGER">USD 고객계좌</option><option value="USDC_CONVERSION">USDC 수취 후 USD 귀속</option></select></label><div className="orderEstimate"><span>예상 주문금액</span><strong>${estimated.toFixed(2)}</strong><small>USD/KRW 1,380.3 · 수수료 합성 0 · 미체결 예약 해제</small></div>{!confirming ? <button type="button" disabled={!readiness?.canPlaceNewOrder} onClick={() => setConfirming(true)}>주문 확인</button> : <div className="finalConfirmation"><h2>최종 확인</h2><ul><li>부분체결될 수 있다.</li><li>체결 후 권리기입과 T+2 위험 승인이 끝나면 결제 대기 토큰이 발행된다.</li><li>T+2 국내 결제와 수탁 확인 전에는 거래하거나 환매할 수 없다.</li><li>결제불이행 예외처리 책임기관은 인가 해외 증권사다.</li></ul><div className="buttonRow"><button type="button" className="textButton" onClick={() => setConfirming(false)}>뒤로</button><button type="submit">서명하고 주문 제출</button></div></div>}</form>
  </>;
}

function OrderScreen({ workflowId, token, primary, secondary, redemption, openBackstage }: { workflowId: string; token: string; primary: PrimaryOrder | undefined; secondary: SecondaryOrder | undefined; redemption: Redemption | undefined; openBackstage: () => void }) {
  const [timeline, setTimeline] = useState<WorkflowTimeline>();
  useEffect(() => { void platformFetch<WorkflowTimeline>(`/workflows/${workflowId}/timeline`, { token }).then(setTimeline).catch(() => undefined); }, [token, workflowId]);
  const kind = primary ? "1차 주문" : secondary ? "24/7 제한 거래" : redemption ? "환매" : "업무";
  const primarySteps = ["접수", "KRX 체결", "권리기입", "결제 대기 토큰 발행", "국내 결제·수탁", "거래 가능"];
  return <>
    <PageHeading eyebrow="ORDER DETAIL" title={`${kind} 상세`}>투자자에게 필요한 진행단계만 먼저 보여주고, 기관·장부·체인 증거는 처리 과정 패널에서 확인한다.</PageHeading>
    <section className="orderDetailCard"><div className="orderDetailHeader"><div><span>업무 번호</span><code>{workflowId}</code></div><span className="statePill">{koreanStatus(primary?.status ?? secondary?.status ?? redemption?.status)}</span></div><ol className="progressSteps">{primarySteps.map((label, index) => <li className={index < Math.max(1, Math.min(6, timeline?.items.length ?? 1)) ? "complete" : ""} key={label}><span>{index + 1}</span><strong>{label}</strong></li>)}</ol><div className="orderFacts"><div><span>상품</span><strong>모의 삼성전자 수탁권리</strong></div><div><span>요청수량</span><strong>{primary?.shareQuantity ?? secondary?.requestedQuantity ?? redemption?.requestedQuantity ?? "-"}주</strong></div><div><span>배분·체결</span><strong>{primary?.allocatedQuantity ?? secondary?.fillQuantity ?? redemption?.allocatedQuantity ?? "-"}주</strong></div><div><span>잠금·해제</span><strong>{secondary?.cancelledQuantity ?? redemption?.releasedQuantity ?? "-"}주</strong></div></div><button type="button" onClick={openBackstage}>처리 과정 보기</button></section>
  </>;
}

function PositionsScreen({ profile, position, journey }: { profile: DemoProfile; position: Position | undefined; journey?: Session["localInvestorJourney"] }) {
  return <>
    <PageHeading eyebrow="PORTFOLIO" title="보유자산">거래 가능한 수탁권리와 아직 사용할 수 없는 수량을 섞지 않고 표시한다.</PageHeading>
    <section className="holdingCard"><div className="holdingTitle"><div><span>005930 · 모의</span><h2>모의 삼성전자 수탁권리</h2></div><strong>{position?.settledRights ?? "0"}주</strong></div><div className="holdingBuckets"><div><span>거래 가능</span><strong>{position?.settledRights ?? "0"}주</strong></div><div><span>국내 결제 대기</span><strong>{position?.pendingRights ?? "0"}주</strong></div><div><span>거래·환매 잠금</span><strong>{position?.lockedRights ?? "0"}주</strong></div><div><span>소각 대기</span><strong>{position?.burnPendingTokens ?? "0"}주</strong></div><div><span>USD 지급청구</span><strong>${money(position?.cashClaim?.amountMinor)}</strong></div></div><div className="ledgerComparison"><div><span>고객별 수탁권리</span><strong>{position ? BigInt(position.settledRights) + BigInt(position.pendingRights) + BigInt(position.lockedRights) : 0n}단위</strong><small>인가 해외 증권사의 기준 기록</small></div><div><span>제한형 토큰 잔액</span><strong>{journey?.redemption?.tokenTotalSupply ?? "-"}단위</strong><small>실행·확인 기록</small></div></div><p className="boundaryCallout">토큰은 고객 권리의 기준장부가 아니다. 고객 권리는 인가 해외 증권사의 고객별 수탁권리 원장에 있고, 토큰은 승인된 발행·이전·잠금·소각을 통제한다.</p><div className="buttonRow"><Link className="primaryLink" href={withProfile("/investor/secondary", profile)}>24/7 거래</Link><Link className="subtleLink" href={withProfile("/investor/rights", profile)}>환매·권리</Link></div></section>
  </>;
}

function SecondaryScreen({ journey, quotes, position, readiness, submit }: { journey?: Session["localInvestorJourney"]; quotes: SecondaryQuote[]; position: Position | undefined; readiness?: Session["customerReadiness"]; submit: (data: FormData) => Promise<void> }) {
  const [selected, setSelected] = useState("");
  const quote = quotes.find((item) => item.quoteId === selected);
  return <>
    <PageHeading eyebrow="CONTROLLED 24/7" title="24/7 제한 거래">국내 결제가 완료된 수탁권리를 적격 투자자와 지정 시장조성자 사이에서만 거래한다.</PageHeading>
    <div className="secondaryBoundary"><strong>KRX 24시간 거래가 아니다.</strong><span>국내 통합계좌 총보유량은 그대로 두고 해외 증권사의 고객별 권리 배분만 바뀐다.</span></div>
    <section className="tradingLayout"><div className="quoteBoard"><div className="quoteHeader"><div><span>지정 시장조성자</span><strong>모의 MM-01</strong></div><small>30초 만료 · 결제완료 재고만 사용</small></div><div className="quoteColumns"><div className="bid"><span>내가 팔 때</span><strong>${money(journey?.normalBidUsdMinor)}</strong><small>MM 매수</small></div><div className="ask"><span>내가 살 때</span><strong>${money(journey?.normalAskUsdMinor)}</strong><small>MM 매도</small></div></div><dl><div><dt>가격 기준시각</dt><dd>{journey?.secondary?.informationEffectiveAt ?? "-"}</dd></div><div><dt>오프아워 조정</dt><dd>정상 반쪽 스프레드 0.50%</dd></div><div><dt>거래 가능 보유</dt><dd>{position?.settledRights ?? "0"}주</dd></div><div><dt>거래 제외</dt><dd>결제 대기 {position?.pendingRights ?? "0"}주</dd></div></dl></div><form action={submit} className="orderTicket compact"><label>지정 MM 호가<select name="quoteId" value={selected} onChange={(event) => setSelected(event.target.value)} required><option value="">호가 선택</option>{quotes.map((item) => <option key={item.quoteId} value={item.quoteId}>{item.investorSide === "BUY" ? "매수" : "매도"} · {item.fundingMode === "USDC_ONCHAIN" ? "USDC" : "USD"} · ${money(item.unitPrice.amountMinor, item.unitPrice.decimals)}</option>)}</select></label><label>정수 수량<input name="quantity" type="number" min="1" step="1" defaultValue="1" /></label><div className="orderEstimate"><span>체결 방식</span><strong>{quote ? `${quote.remainingQuantity}주까지` : "호가 선택"}</strong><small>부분체결 1회 · 미체결 예약 자동 해제</small></div><button type="submit" disabled={!selected || !readiness?.canPlaceNewOrder}>서명하고 주문</button></form></section>
  </>;
}

function ActivitiesScreen({ profile, activities, openBackstage }: { profile: DemoProfile; activities: Activity[]; openBackstage: (id: string) => void }) {
  const workflows = Array.from(new Map(activities.map((item) => [item.workflowId, item])).values());
  return <>
    <PageHeading eyebrow="ORDERS & ACTIVITIES" title="주문·활동">투자자 행동별로 묶고 같은 업무 번호의 기관 처리와 증거를 바로 열 수 있다.</PageHeading>
    <section className="activityList">{workflows.length ? workflows.map((item) => <article key={item.workflowId}><div><span>{item.category}</span><h2>{item.labelKo}</h2><p>{item.actorRoleKo} · {item.recordLayerKo}</p></div><div><time>{new Date(item.occurredAt).toLocaleString("ko-KR")}</time><code>{shortId(item.workflowId)}</code><div className="buttonRow"><Link className="subtleLink" href={withProfile(`/investor/orders/${item.workflowId}`, profile)}>상세</Link><button type="button" onClick={() => openBackstage(item.workflowId)}>처리 과정</button></div></div></article>) : <p className="emptyState">아직 주문이나 활동이 없다.</p>}</section>
  </>;
}

function RightsScreen({ journey, profile, submitRedemption, convertDividend, submitVote }: { journey?: Session["localInvestorJourney"]; profile: DemoProfile; submitRedemption: (data: FormData) => Promise<void>; convertDividend: () => Promise<void>; submitVote: (value: "FOR" | "AGAINST" | "ABSTAIN") => Promise<void> }) {
  const rights = journey?.rights;
  return <>
    <PageHeading eyebrow="RIGHTS & REDEMPTION" title="권리">환매, 현금배당, 의결권과 지갑 복구를 각각 독립된 업무로 처리한다.</PageHeading>
    <section className="rightsList"><article><div><span>환매</span><h2>권리를 종료하고 USD로 받기</h2><p>국내 매도와 T+2 뒤 수탁권리를 지급청구로 바꾸고 토큰을 소각한다.</p></div><form action={submitRedemption} className="inlineAction"><input name="quantity" aria-label="환매 수량" type="number" min="1" step="1" defaultValue="1" /><button type="submit">환매 요청</button></form></article><article><div><span>현금배당</span><h2>USD {money(rights?.dividend?.netUsdMinor)} 지급</h2><p>기준일 수탁권리 스냅샷과 국내 배정총액을 대사한다. USD 지급 후에만 USDC 전환을 선택한다.</p></div><button type="button" disabled={!rights?.dividend?.quoteId} onClick={() => void convertDividend()}>USDC 전환 선택</button></article><article><div><span>의결권</span><h2>{rights?.voting?.titleKo ?? "안건 준비 중"}</h2><p>기준수량 {rights?.voting?.eligibleQuantity ?? "0"}주 · 미응답은 행사하지 않는다.</p></div><div className="buttonRow">{(["FOR", "AGAINST", "ABSTAIN"] as const).map((value) => <button key={value} type="button" onClick={() => void submitVote(value)}>{value === "FOR" ? "찬성" : value === "AGAINST" ? "반대" : "기권"}</button>)}</div></article><article><div><span>지갑 복구</span><h2>전용 지갑 교체</h2><p>기존 지갑 동결 뒤 권리 담당과 준법 담당이 독립 승인한다. 자기보관 USDC는 플랫폼이 복구하지 못한다.</p></div><Link className="subtleLink" href={withProfile("/investor?review=wallet", profile)}>복구 상태 보기</Link></article></section>
  </>;
}

function SupportScreen({ complaints, submit }: { complaints: Complaint[]; submit: (data: FormData) => Promise<void> }) {
  return <>
    <PageHeading eyebrow="SUPPORT" title="지원">플랫폼 기술문의와 증권계좌·거래·규제 민원을 구분해 책임기관에 배정한다.</PageHeading>
    <section className="supportLayout"><form action={submit} className="orderTicket"><label>문의 유형<select name="type"><option value="PLATFORM_TECHNICAL">플랫폼 기술문의</option><option value="ACCOUNT">증권계좌 민원</option><option value="TRADING_ERROR">거래오류 민원</option><option value="REGULATORY">규제·권리 민원</option></select></label><label>제목<input name="titleKo" required defaultValue="모의 거래 처리 확인 요청" /></label><label>내용<textarea name="descriptionKo" required defaultValue="동일 업무 번호의 처리상태와 책임기관을 확인하고 싶다." /></label><button type="submit">민원 접수</button></form><div className="complaintList"><h2>내 문의</h2>{complaints.map((item) => <article key={item.complaintId}><strong>{item.titleKo}</strong><span>{koreanStatus(item.status)}</span><p>{item.responsibleInstitutionId ?? "책임기관 배정 대기"}</p></article>)}</div></section>
  </>;
}

function WorkflowBackstage({ workflowId, token, close }: { workflowId: string | undefined; token: string; close: () => void }) {
  const [timeline, setTimeline] = useState<WorkflowTimeline>();
  useEffect(() => {
    if (!workflowId) return setTimeline(undefined);
    void platformFetch<WorkflowTimeline>(`/workflows/${workflowId}/timeline`, { token }).then(setTimeline).catch(() => setTimeline(undefined));
  }, [token, workflowId]);
  if (!workflowId) return null;
  const lanes = ["투자자", "토큰 플랫폼", "인가 해외 증권사", "국내 주문집행 증권사", "수탁은행·상임대리인", "제한형 토큰 실행", "지정 시장조성자"];
  return <div className="drawerBackdrop" role="presentation" onMouseDown={close}><aside className="backstageDrawer" role="dialog" aria-modal="true" aria-labelledby="backstage-title" onMouseDown={(event) => event.stopPropagation()}><header><div><p className="eyebrow">WORKFLOW BACKSTAGE</p><h2 id="backstage-title">처리 과정 보기</h2><code>{workflowId}</code></div><button type="button" className="closeButton" aria-label="닫기" onClick={close}>×</button></header><div className="ledgerLegend"><span>국내 법적 장부·통합 보유총량</span><span>고객별 수탁권리 원장</span><span>제한형 토큰 장부</span><span>USD·USDC</span></div><p className="boundaryCallout">체인 거래가 성공해도 해외 증권사의 권리 원장 반영까지 확인돼야 업무상 완료다.</p><div className="laneTimeline">{lanes.map((lane) => { const items = timeline?.items.filter((item) => item.actorRoleKo.includes(lane.split("·")[0] ?? lane)) ?? []; return <section key={lane}><h3>{lane}</h3>{items.length ? items.map((item) => <article key={item.eventId}><div><strong>{item.labelKo}</strong><span>{item.category}</span></div><p>{item.recordLayerKo}</p><small>{new Date(item.occurredAt).toLocaleString("ko-KR")} · 다음: {item.nextActionKo}</small>{item.transactionHash ? <code>{shortId(item.transactionHash)}</code> : null}</article>) : <p className="laneEmpty">아직 확인된 단계가 없다.</p>}</section>; })}</div><Link className="primaryLink institutionDeepLink" href={`/institution/workflows/${workflowId}`}>기관 화면에서 같은 업무 보기</Link></aside></div>;
}
