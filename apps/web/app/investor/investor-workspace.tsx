"use client";

import { walletOwnershipMessage } from "@rwa/domain/protection";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { keccak256, toHex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { LifecycleGuide } from "../components/lifecycle-guide";
import {
  allProducts,
  demoTokens,
  platformFetch,
  type Complaint,
  type Consent,
  type Disclosure,
  type DemoProfile,
  type Product,
  type PrimaryOrder,
  type Redemption,
  type SecondaryOrder,
  type SecondaryQuote,
  type Session,
} from "../lib/platform-api";

const profileLabels = {
  investorA: "허용 고객 A (USD)",
  investorB: "허용 고객 B (USDC)",
  denied: "거절 고객",
  expired: "만료 고객",
};

export function InvestorWorkspace({
  initialProfile = "investorA",
}: {
  initialProfile?: DemoProfile;
}) {
  const [profile, setProfile] = useState<DemoProfile>(initialProfile);
  const [session, setSession] = useState<Session>();
  const [disclosure, setDisclosure] = useState<Disclosure>();
  const [consent, setConsent] = useState<Consent>();
  const [products, setProducts] = useState<Product[]>([]);
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [primaryOrders, setPrimaryOrders] = useState<PrimaryOrder[]>([]);
  const [secondaryOrders, setSecondaryOrders] = useState<SecondaryOrder[]>([]);
  const [secondaryQuotes, setSecondaryQuotes] = useState<SecondaryQuote[]>([]);
  const [redemptions, setRedemptions] = useState<Redemption[]>([]);
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("데이터를 불러오는 중이다.");
  const refreshSequence = useRef(0);
  const token = demoTokens[profile];
  const demoOrderAccount = useMemo(() => {
    if (profile === "investorA") return privateKeyToAccount(keccak256(toHex("PRIMARY-DEMO-A")));
    if (profile === "investorB") return privateKeyToAccount(keccak256(toHex("PRIMARY-DEMO-B")));
    return undefined;
  }, [profile]);

  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    try {
      const [
        nextSession,
        nextDisclosure,
        nextConsent,
        productItems,
        complaintPage,
        orderPage,
        secondaryPage,
        redemptionPage,
      ] = await Promise.all([
        platformFetch<Session>("/session", { token }),
        platformFetch<Disclosure>("/disclosures/current"),
        platformFetch<Consent>("/disclosure-consents/current", { token }),
        allProducts(),
        platformFetch<{ items: Complaint[] }>("/complaints", { token }),
        platformFetch<{ items: PrimaryOrder[] }>("/primary-orders", { token }),
        platformFetch<{ items: SecondaryOrder[] }>("/secondary-orders", { token }),
        platformFetch<{ items: Redemption[] }>("/redemptions", { token }),
      ]);
      const quotePages = await Promise.all(
        (["USD_LEDGER", "USDC_ONCHAIN"] as const).flatMap((fundingMode) =>
          (["BUY", "SELL"] as const).map((investorSide) =>
            platformFetch<{ items: SecondaryQuote[] }>(
              `/quotes?securityId=990001&investorSide=${investorSide}&fundingMode=${fundingMode}`,
            ),
          ),
        ),
      );
      if (sequence !== refreshSequence.current) return;
      setSession(nextSession);
      setDisclosure(nextDisclosure);
      setConsent(nextConsent);
      setProducts(productItems);
      setComplaints(complaintPage.items);
      setPrimaryOrders(orderPage.items);
      setSecondaryOrders(secondaryPage.items);
      setRedemptions(redemptionPage.items);
      setSecondaryQuotes(quotePages.flatMap((page) => page.items));
      setMessage("모의 기준정보와 고객 상태를 확인했다.");
    } catch (error) {
      if (sequence !== refreshSequence.current) return;
      setMessage(error instanceof Error ? error.message : "조회에 실패했다.");
    }
  }, [token]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const visibleProducts = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return products
      .filter((product) =>
        needle
          ? product.securityId.includes(needle) || product.nameKo.toLowerCase().includes(needle)
          : product.representative,
      )
      .slice(0, 24);
  }, [products, query]);

  async function acceptDisclosure() {
    if (!disclosure) return;
    try {
      await platformFetch("/disclosure-consents", {
        token,
        method: "POST",
        body: {
          disclosureId: disclosure.disclosureId,
          version: disclosure.version,
          consentedAt: new Date().toISOString(),
        },
      });
      setMessage("위험공시 동의를 접수했다. 작업 실행기 반영 후 상태가 바뀐다.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "동의 접수에 실패했다.");
    }
  }

  async function connectWallet() {
    if (!session) return;
    try {
      const account = readiness?.activeWallet
        ? privateKeyToAccount(generatePrivateKey())
        : (demoOrderAccount ?? privateKeyToAccount(generatePrivateKey()));
      const signature = await account.signMessage({
        message: walletOwnershipMessage(session.actorId, account.address, "LINK"),
      });
      await platformFetch("/wallet-link-requests", {
        token,
        method: "POST",
        body: { wallet: account.address, ownershipSignature: signature },
      });
      setMessage(
        `시험용 자기보관 지갑 ${account.address.slice(0, 10)}… 연결을 접수했다. 기관 승인과 체인 반영 전에는 사용할 수 없다.`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "지갑 연결에 실패했다.");
    }
  }

  async function submitPrimaryOrder(formData: FormData) {
    if (!session?.localPrimaryScenario || !demoOrderAccount) return;
    try {
      const quantity = String(formData.get("quantity"));
      const fundingMode = String(formData.get("fundingMode"));
      const limit = session.localPrimaryScenario.referenceLimitKrw;
      const orderId = crypto.randomUUID();
      const fundingAmountMinor = (
        (BigInt(quantity) * BigInt(limit) * 1000n + 13802n) /
        13803n
      ).toString();
      const expiresAt = String(Math.floor(Date.now() / 1000) + 3600);
      const policyVersion = keccak256(toHex(session.localPrimaryScenario.policyVersion));
      const message = {
        orderId,
        investor: demoOrderAccount.address,
        securityId: session.localPrimaryScenario.securityId,
        shareQuantity: quantity,
        krwLimitPrice: limit,
        targetTradingDate: "2026-08-31",
        fundingMode,
        fundingAmountMinor,
        nonce: String(Date.now()),
        expiresAt,
        policyVersion,
      };
      const signature = await demoOrderAccount.signTypedData({
        domain: session.localPrimaryScenario.intentDomain,
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
          krwLimitPrice: BigInt(limit),
          fundingAmountMinor: BigInt(fundingAmountMinor),
          nonce: BigInt(message.nonce),
          expiresAt: BigInt(expiresAt),
        },
      });
      await platformFetch("/primary-orders", {
        token,
        method: "POST",
        body: {
          securityId: message.securityId,
          shareQuantity: quantity,
          krwLimitPrice: limit,
          targetTradingDate: message.targetTradingDate,
          fundingMode,
          signedIntent: {
            domain: session.localPrimaryScenario.intentDomain,
            primaryType: "PrimaryOrderIntent",
            message,
            signer: demoOrderAccount.address,
            signature,
          },
        },
      });
      setMessage("로컬 1차 지정가 주문을 접수했다. 취합과 모의 KRX 체결을 기다린다.");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "1차 주문 접수에 실패했다.");
    }
  }

  async function requestWalletReplacement() {
    if (!session || !readiness?.activeWallet) return;
    try {
      const account = privateKeyToAccount(generatePrivateKey());
      const signature = await account.signMessage({
        message: walletOwnershipMessage(session.actorId, account.address, "REPLACE"),
      });
      await platformFetch("/wallet-replacement-requests", {
        token,
        method: "POST",
        body: {
          oldWallet: readiness.activeWallet,
          newWallet: account.address,
          reasonKo: "시험 전용 지갑 교체",
          newWalletSignature: signature,
        },
      });
      setMessage(
        "지갑 교체 검토를 접수했다. 기존 지갑은 즉시 동결되고 잔액 복구는 후속 기능에서 수행한다.",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "지갑 교체 요청에 실패했다.");
    }
  }

  async function submitSecondaryOrder(formData: FormData) {
    if (!session?.localSecondaryScenario || !demoOrderAccount) return;
    try {
      const quote = secondaryQuotes.find(
        (item) => item.quoteId === String(formData.get("quoteId")),
      );
      if (!quote) throw new Error("유효한 지정 시장조성자 호가를 선택한다.");
      const quantity = String(formData.get("quantity"));
      const orderId = crypto.randomUUID();
      const paymentAmountMinor = (
        BigInt(quote.unitPrice.amountMinor) * BigInt(quantity)
      ).toString();
      const expiresAt = String(Math.floor(new Date(quote.expiresAt).getTime() / 1000));
      const message = {
        orderId,
        quoteId: quote.quoteId,
        investor: demoOrderAccount.address,
        token: quote.tokenAddress,
        investorSide: quote.investorSide,
        paymentMode: quote.fundingMode,
        paymentAssetId: quote.paymentAssetId,
        shareQuantity: quantity,
        paymentAmountMinor,
        nonce: String(Date.now()),
        expiresAt,
        policyVersion: keccak256(toHex(session.localSecondaryScenario.policyVersion)),
      };
      const signature = await demoOrderAccount.signTypedData({
        domain: session.localSecondaryScenario.intentDomain,
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
      await platformFetch("/secondary-orders", {
        token,
        method: "POST",
        body: {
          quoteId: quote.quoteId,
          shareQuantity: quantity,
          investorSide: quote.investorSide,
          fundingMode: quote.fundingMode,
          signedIntent: {
            domain: session.localSecondaryScenario.intentDomain,
            primaryType: "SecondaryOrderIntent",
            message,
            signer: demoOrderAccount.address,
            signature,
          },
        },
      });
      setMessage("24시간 제한 거래 주문을 접수했다. 해외 증권사의 정산 승인을 기다린다.");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "24시간 주문에 실패했다.");
    }
  }

  async function submitComplaint(formData: FormData) {
    try {
      await platformFetch("/complaints", {
        token,
        method: "POST",
        body: {
          type: String(formData.get("type")),
          titleKo: String(formData.get("titleKo")),
          descriptionKo: String(formData.get("descriptionKo")),
          disclosureVersion: disclosure?.version ?? "SIM-RISK-2",
        },
      });
      setMessage("민원을 접수했다. 책임기관 배정 전 상태로 보존된다.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "민원 접수에 실패했다.");
    }
  }

  async function submitRedemption(formData: FormData) {
    if (!session?.localRedemptionScenario || !demoOrderAccount) return;
    try {
      const quantity = String(formData.get("quantity"));
      const redemptionId = crypto.randomUUID();
      const expiresAt = String(Math.floor(Date.now() / 1000) + 3600);
      const message = {
        redemptionId,
        investor: demoOrderAccount.address,
        token: session.localRedemptionScenario.tokenAddress,
        shareQuantity: quantity,
        krwLimitPrice: session.localRedemptionScenario.referenceLimitKrw,
        targetTradingDate: "2026-08-31",
        nonce: String(Date.now()),
        expiresAt,
        policyVersion: keccak256(toHex(session.localRedemptionScenario.policyVersion)),
      };
      const signature = await demoOrderAccount.signTypedData({
        domain: session.localRedemptionScenario.intentDomain,
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
          krwLimitPrice: BigInt(message.krwLimitPrice),
          nonce: BigInt(message.nonce),
          expiresAt: BigInt(expiresAt),
        },
      });
      await platformFetch("/redemptions", {
        token,
        method: "POST",
        body: {
          securityId: session.localRedemptionScenario.securityId,
          shareQuantity: quantity,
          krwLimitPrice: message.krwLimitPrice,
          targetTradingDate: message.targetTradingDate,
          signedIntent: {
            domain: session.localRedemptionScenario.intentDomain,
            primaryType: "RedemptionIntent",
            message,
            signer: demoOrderAccount.address,
            signature,
          },
        },
      });
      setMessage("환매 요청과 권리·토큰 잠금을 접수했다. 국내 취합매도를 기다린다.");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "환매 요청에 실패했다.");
    }
  }

  async function cancelRedemption(redemptionId: string) {
    try {
      await platformFetch(`/redemptions/${redemptionId}/cancellations`, {
        token,
        method: "POST",
        body: { reasonKo: "국내 제출 전 투자자 취소" },
      });
      setMessage("환매 취소를 접수해 권리와 토큰 잠금을 해제했다.");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "환매 취소에 실패했다.");
    }
  }

  async function convertDividend() {
    const dividend = session?.localRightsScenario?.dividend;
    if (!dividend?.paymentId || !dividend.quoteId) return;
    try {
      await platformFetch("/dividend-conversions", {
        token,
        method: "POST",
        body: { dividendPaymentId: dividend.paymentId, quoteId: dividend.quoteId },
      });
      setMessage("배당 USD의 합성 USDC 전환을 접수했다. 만료나 실패 시 USD 예약을 해제한다.");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "배당 전환에 실패했다.");
    }
  }

  async function submitVote(instruction: "FOR" | "AGAINST" | "ABSTAIN") {
    const voting = session?.localRightsScenario?.voting;
    if (!voting) return;
    try {
      await platformFetch("/voting-instructions", {
        token,
        method: "POST",
        body: { meetingId: voting.meetingId, agendaId: voting.agendaId, instruction },
      });
      setMessage("의결권 지시를 접수했다. 미응답 수량은 행사하지 않는다.");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "의결권 지시에 실패했다.");
    }
  }

  const readiness = session?.customerReadiness;
  const latestPrimary = primaryOrders.at(0);
  const latestSecondary = secondaryOrders.at(0);
  const latestRedemption = redemptions.at(0);
  const investorSteps = [
    {
      id: "investor-readiness",
      label: "고객 준비",
      stateCode: readiness?.canPlaceNewOrder ? "READY" : "ACTION_REQUIRED",
      detail: readiness?.canPlaceNewOrder ? "공시·지갑·적격성 확인" : "차단 사유를 먼저 해소",
      owner: "투자자와 인가 해외 증권사",
      sourceRecord: "해외 증권사 고객판정·공시동의·지갑 연결",
      nextAction: readiness?.canPlaceNewOrder
        ? "1차 발행 주문을 제출한다."
        : "위험공시 동의와 지갑 상태를 확인한다.",
      blocked: !readiness?.canPlaceNewOrder,
      ...(readiness?.blockingReasons.length
        ? { blockedReason: readiness.blockingReasons.map((reason) => reason.messageKo).join(" · ") }
        : {}),
    },
    {
      id: "investor-primary",
      label: "1차 발행",
      stateCode: latestPrimary ? "IN_PROGRESS" : "NOT_STARTED",
      detail: latestPrimary
        ? `${latestPrimary.allocatedQuantity}주 배분 · ${latestPrimary.tokenStatus}`
        : "정수 지정가 주문 대기",
      owner: "인가 해외 증권사와 국내 주문집행 증권사",
      sourceRecord: "고객 원주문·국내 체결·고객별 수탁권리 원장",
      nextAction: latestPrimary
        ? "기관 콘솔에서 독립 승인을 진행한다."
        : "USD 또는 USDC 경로로 주문한다.",
    },
    {
      id: "investor-t2",
      anchorId: "investor-primary",
      label: "T+2 전환",
      stateCode:
        latestPrimary?.tokenStatus === "TRADABLE"
          ? "COMPLETED"
          : latestPrimary
            ? "WAITING_INSTITUTION"
            : "NOT_STARTED",
      detail:
        latestPrimary?.tokenStatus === "TRADABLE"
          ? "결제·수탁 확인 완료"
          : "결제와 수탁을 각각 확인",
      owner: "수탁은행·상임대리인과 KSD 모의 응답",
      sourceRecord: "국내 결제 확인·수탁수량 확인",
      nextAction: "기관 콘솔에서 결제와 수탁 확인을 모두 완료한다.",
    },
    {
      id: "investor-secondary",
      label: "24/7 제한 거래",
      stateCode: latestSecondary ? "IN_PROGRESS" : "NOT_STARTED",
      detail: latestSecondary
        ? `${latestSecondary.fillQuantity}주 체결 · ${latestSecondary.status}`
        : "지정 MM 호가 대기",
      owner: "투자자·지정 시장조성자·인가 해외 증권사",
      sourceRecord: "고객별 수탁권리 원장·토큰·고객자금",
      nextAction: secondaryQuotes.length
        ? "유효한 지정가 호가를 선택한다."
        : "기관 콘솔에서 시장조성자 호가를 게시한다.",
    },
    {
      id: "investor-hedge",
      anchorId: "investor-secondary",
      label: "MM 헤지",
      stateCode: latestSecondary?.status === "COMPLETED" ? "WAITING_INSTITUTION" : "NOT_STARTED",
      detail: "다음 KRX 개장 재고조정",
      owner: "지정 시장조성자·인가 해외 증권사·국내 증권사",
      sourceRecord: "시장조성자 순포지션·헤지 대기열",
      nextAction: "기관 콘솔에서 헤지 생성과 다음 개장일 인계를 확인한다.",
    },
    {
      id: "investor-redemption",
      label: "환매",
      stateCode: latestRedemption ? "IN_PROGRESS" : "NOT_STARTED",
      detail: latestRedemption
        ? `${latestRedemption.allocatedQuantity}주 배분 · ${latestRedemption.status}`
        : "결제완료 권리만 사용",
      owner: "인가 해외 증권사와 국내 주문집행 증권사",
      sourceRecord: "환매 요청·USD 지급청구·토큰 소각 증거",
      nextAction: "환매 요청 뒤 기관 콘솔에서 매도·T+2·지급·소각을 확인한다.",
    },
    {
      id: "investor-rights",
      label: "권리업무",
      stateCode: session?.localRightsScenario ? "READY" : "NOT_STARTED",
      detail: "배당·의결권·지갑 복구",
      owner: "인가 해외 증권사와 수탁은행·상임대리인",
      sourceRecord: "기준일 권리 스냅샷·대사·보고 증거",
      nextAction: "배당 지급상태와 의결권 기준수량을 확인한다.",
    },
  ];
  return (
    <div className="workspaceContent">
      <section className="workspaceIntro">
        <div>
          <p className="eyebrow">CUSTOMER READINESS</p>
          <h1>투자자 업무공간</h1>
          <p>합성 고객 판정부터 공시 동의, 전용 지갑과 상품 후보를 한 흐름으로 확인한다.</p>
        </div>
        <div className="scenarioTools">
          <label className="profilePicker">
            검토용 시나리오 전환
            <select
              value={profile}
              onChange={(event) => setProfile(event.target.value as DemoProfile)}
            >
              {Object.entries(profileLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <Link className="subtleLink" href="/investor/onboarding">
            온보딩 다시 시작
          </Link>
        </div>
      </section>

      <div className="noticeBar" role="status">
        <span>모의 환경 · {message}</span>
        <button className="subtleButton" type="button" onClick={() => void refresh()}>
          다시 불러오기
        </button>
      </div>

      <LifecycleGuide
        title="투자자 생애주기 시연"
        description="단계 카드를 누르면 해당 업무와 항상 표시되는 실행 버튼으로 이동한다. 비활성 버튼은 필요한 선행조건을 함께 설명한다."
        steps={investorSteps}
      />

      <section className="metricGrid" aria-label="고객 준비상태">
        <StatusCard label="고객확인" value={readiness?.eligibility ?? "확인 중"} />
        <StatusCard label="투자자 보호" value={readiness?.investorProtection ?? "확인 중"} />
        <StatusCard label="전용 지갑" value={readiness?.wallet ?? "확인 중"} />
        <StatusCard label="신규 주문" value={readiness?.canPlaceNewOrder ? "가능" : "차단"} />
      </section>

      <section className="panelGrid" id="investor-rights">
        <article className="panel">
          <div className="panelHeading">
            <div>
              <p className="eyebrow">CASH DIVIDEND</p>
              <h2>현금배당과 선택형 USDC 전환</h2>
            </div>
            <span className="statePill">
              {session?.localRightsScenario?.dividend?.paymentStatus ??
                session?.localRightsScenario?.dividend?.status ??
                "검토 대기"}
            </span>
          </div>
          <p className="panelCopy">
            기준수량 {session?.localRightsScenario?.dividend?.eligibleQuantity ?? "-"}주 · USD
            지급액 {session?.localRightsScenario?.dividend?.netUsdMinor ?? "-"}센트
          </p>
          <p className="panelCopy">
            합성 조건은 1주당 USD 1.00, 세금·수수료 0이다. 실제 배당이나 세금정책이 아니다.
          </p>
          <button
            type="button"
            disabled={
              !session?.localRightsScenario?.dividend?.quoteId ||
              session.localRightsScenario.dividend.conversionStatus ===
                "DIVIDEND_CONVERSION_COMPLETED"
            }
            onClick={() => void convertDividend()}
          >
            30초 견적으로 USDC 전환
          </button>
          {!session?.localRightsScenario?.dividend?.quoteId ? (
            <small className="actionHint">
              USD 배당 지급과 기관 배분 승인이 끝나면 전환 버튼이 활성화된다.
            </small>
          ) : null}
          <small>
            상태 {session?.localRightsScenario?.dividend?.conversionStatus ?? "USD 지급 전"} · USDC{" "}
            {session?.localRightsScenario?.dividend?.usdcPaidMinor ?? "0"} 최소단위
          </small>
        </article>

        <article className="panel">
          <div className="panelHeading">
            <div>
              <p className="eyebrow">VOTING INSTRUCTION</p>
              <h2>의결권 지시</h2>
            </div>
            <span className="statePill">
              {session?.localRightsScenario?.voting?.instruction ?? "미응답"}
            </span>
          </div>
          <h3>{session?.localRightsScenario?.voting?.titleKo ?? "기준수량 확정 대기"}</h3>
          <p className="panelCopy">
            기준수량 {session?.localRightsScenario?.voting?.eligibleQuantity ?? "0"}주 · 미응답은
            행사하지 않는다.
          </p>
          <div className="buttonGroup">
            {(["FOR", "AGAINST", "ABSTAIN"] as const).map((instruction) => (
              <button
                type="button"
                key={instruction}
                disabled={!Number(session?.localRightsScenario?.voting?.eligibleQuantity ?? 0)}
                onClick={() => void submitVote(instruction)}
              >
                {instruction === "FOR" ? "찬성" : instruction === "AGAINST" ? "반대" : "기권"}
              </button>
            ))}
          </div>
        </article>
      </section>

      <section className="panelGrid" id="investor-readiness">
        <article className="panel">
          <div className="panelHeading">
            <div>
              <p className="eyebrow">RISK DISCLOSURE</p>
              <h2>현재 위험공시</h2>
            </div>
            <span className="statePill">{consent?.status ?? "조회 중"}</span>
          </div>
          <h3>{disclosure?.titleKo}</h3>
          <div className="disclosureList">
            {disclosure?.sections.map((section) => (
              <details key={section.code}>
                <summary>{section.titleKo}</summary>
                <p>{section.summaryKo}</p>
              </details>
            ))}
          </div>
          <button type="button" disabled={!disclosure} onClick={() => void acceptDisclosure()}>
            위 내용을 확인하고 전자 동의
          </button>
        </article>

        <article className="panel">
          <div className="panelHeading">
            <div>
              <p className="eyebrow">DEDICATED WALLET</p>
              <h2>전용 지갑</h2>
            </div>
            <span className="statePill">자기보관</span>
          </div>
          <p className="panelCopy">
            브라우저에서 만든 시험 전용키로 소유확인 메시지만 서명한다. 개인키는 서버로 전송하지
            않는다.
          </p>
          <button type="button" disabled={!session} onClick={() => void connectWallet()}>
            시험 전용 지갑 연결 요청
          </button>
          {readiness?.activeWallet && <code className="addressLine">{readiness.activeWallet}</code>}
          {readiness?.activeWallet && (
            <button
              className="subtleButton walletReplace"
              type="button"
              onClick={() => void requestWalletReplacement()}
            >
              새 지갑으로 교체 검토
            </button>
          )}
          {session?.localRightsScenario?.recovery ? (
            <p className="panelCopy">
              복구 {session.localRightsScenario.recovery.status} · 권리 승인{" "}
              {session.localRightsScenario.recovery.rights_approved ? "완료" : "대기"} · 준법 승인{" "}
              {session.localRightsScenario.recovery.compliance_approved ? "완료" : "대기"}
            </p>
          ) : null}
          <small>USD 고객계좌는 유지되지만 분실 지갑의 자기보관 USDC는 복구할 수 없다.</small>
          <ul className="reasonList">
            {readiness?.blockingReasons.map((reason) => (
              <li key={reason.code}>{reason.messageKo}</li>
            ))}
          </ul>
        </article>
      </section>

      <section className="panel widePanel" id="investor-redemption">
        <div className="panelHeading">
          <div>
            <p className="eyebrow">PRIMARY REDEMPTION</p>
            <h2>일반 투자자 환매 생애주기</h2>
          </div>
          <span className="statePill">USD 지급 전용</span>
        </div>
        <p className="panelCopy">
          기존 990001 1차 발행에서 T+2가 끝난 권리만 잠근다. 실제 주식·자금·가격이 아닌 모의
          흐름이다.
        </p>
        <section className="metricGrid compactMetrics">
          <StatusCard
            label="결제완료 권리"
            value={`${session?.localRedemptionScenario?.settledQuantity ?? "0"}주`}
          />
          <StatusCard
            label="환매 가능"
            value={`${session?.localRedemptionScenario?.availableQuantity ?? "0"}주`}
          />
          <StatusCard
            label="환매 잠금"
            value={`${session?.localRedemptionScenario?.redemptionLockedQuantity ?? "0"}주`}
          />
          <StatusCard
            label="소각 대기"
            value={`${session?.localRedemptionScenario?.burnPendingQuantity ?? "0"}주`}
          />
        </section>
        <form action={(formData) => void submitRedemption(formData)} className="stackForm">
          <label>
            정수 환매수량
            <input
              name="quantity"
              type="number"
              min="1"
              step="1"
              defaultValue={profile === "investorB" ? "2" : "3"}
            />
          </label>
          <p>KRW 지정가 257,000원 · 다음 모의 KRX 거래일 · T+2 뒤 USD 고객계좌 지급</p>
          <button
            type="submit"
            disabled={
              !demoOrderAccount ||
              BigInt(session?.localRedemptionScenario?.availableQuantity ?? "0") === 0n
            }
          >
            서명하고 환매 요청
          </button>
          {BigInt(session?.localRedemptionScenario?.availableQuantity ?? "0") === 0n ? (
            <small className="actionHint">T+2가 끝난 결제완료 권리가 있어야 환매할 수 있다.</small>
          ) : null}
        </form>
        <div className="timelineList">
          {redemptions.length === 0 ? (
            <p className="emptyState">접수한 환매가 없다.</p>
          ) : (
            redemptions.map((item) => (
              <div key={item.redemptionId}>
                <strong>
                  {item.requestedQuantity}주 환매 · 배분 {item.allocatedQuantity}주
                </strong>
                <span>{item.status}</span>
                <small>
                  미체결 해제 {item.releasedQuantity}주 · USD 청구 {item.cashClaimUsdMinor ?? "-"}
                  센트 · 수수료 0(합성)
                </small>
                {!item.domesticSaleSubmitted &&
                  !item.tokenBurned &&
                  item.status !== "REDEMPTION_CANCELLED" && (
                    <button
                      className="subtleButton"
                      type="button"
                      onClick={() => void cancelRedemption(item.redemptionId)}
                    >
                      국내 제출 전 취소
                    </button>
                  )}
              </div>
            ))
          )}
        </div>
      </section>

      <section className="panel widePanel" id="investor-secondary">
        <div className="panelHeading">
          <div>
            <p className="eyebrow">CONTROLLED 24/7 SECONDARY</p>
            <h2>로컬 24/7 제한 거래 시험</h2>
          </div>
          <span className="statePill">투자자 ↔ 지정 MM</span>
        </div>
        <p className="panelCopy">
          {session?.localSecondaryScenario?.displayName} · 결제완료 권리만 거래하며 공식 삼성전자
          상품이 아니다.
        </p>
        <section className="metricGrid compactMetrics">
          <StatusCard
            label="결제완료 권리"
            value={`${session?.localSecondaryScenario?.balances.settledRights ?? "0"}주`}
          />
          <StatusCard
            label="결제 대기"
            value={`${session?.localSecondaryScenario?.balances.pendingRights ?? "0"}주`}
          />
          <StatusCard label="USDC/USD" value={session?.localSecondaryScenario?.usdcUsd ?? "-"} />
          <StatusCard
            label="정보 기준시각"
            value={session?.localSecondaryScenario?.informationEffectiveAt.slice(11, 19) ?? "-"}
          />
        </section>
        <form action={(formData) => void submitSecondaryOrder(formData)} className="stackForm">
          <label>
            지정 시장조성자 호가
            <select name="quoteId" required defaultValue="">
              <option value="" disabled>
                유효한 호가 선택
              </option>
              {secondaryQuotes.map((quote) => (
                <option key={quote.quoteId} value={quote.quoteId}>
                  {quote.investorSide} · {quote.fundingMode} · {quote.remainingQuantity}주 ·{" "}
                  {quote.unitPrice.amountMinor} 최소단위
                </option>
              ))}
            </select>
          </label>
          <label>
            정수 주문수량
            <input name="quantity" type="number" min="1" step="1" defaultValue="8" />
          </label>
          <p>호가 만료 30초 · 부분체결은 한 번만 실행 · 미체결 잔량은 자동 해제</p>
          <button
            type="submit"
            disabled={!readiness?.canPlaceNewOrder || secondaryQuotes.length === 0}
          >
            서명하고 24시간 주문 접수
          </button>
          {secondaryQuotes.length === 0 ? (
            <small className="actionHint">
              기관 콘솔에서 지정 시장조성자 호가를 먼저 게시해야 한다.
            </small>
          ) : !readiness?.canPlaceNewOrder ? (
            <small className="actionHint">
              고객 적격성, 위험공시와 전용 지갑을 먼저 완료해야 한다.
            </small>
          ) : null}
        </form>
        <div className="timelineList">
          {secondaryOrders.length === 0 ? (
            <p className="emptyState">접수한 24시간 거래 주문이 없다.</p>
          ) : (
            secondaryOrders.map((order) => (
              <div key={order.orderId}>
                <strong>
                  {order.investorSide} {order.requestedQuantity}주 · {order.fundingMode}
                </strong>
                <span>{order.status}</span>
                <small>
                  체결 {order.fillQuantity} · 취소 및 예약해제 {order.cancelledQuantity} ·
                  권리/토큰/자금{" "}
                  {order.rightsFinalized && order.chainFinalized && order.fundsFinalized
                    ? "일치"
                    : "확인 중"}
                </small>
              </div>
            ))
          )}
        </div>
        {session?.localSecondaryScenario?.notices.map((notice) => (
          <small key={notice} className="panelCopy">
            {notice}
          </small>
        ))}
      </section>

      <section className="panel widePanel" id="investor-primary">
        <div className="panelHeading">
          <div>
            <p className="eyebrow">LOCAL PRIMARY LIFECYCLE</p>
            <h2>로컬 생애주기 시험</h2>
          </div>
          <span className="statePill">실제 거래 불가</span>
        </div>
        <p className="panelCopy">
          {session?.localPrimaryScenario?.displayName} · KOSPI 200 공식 후보 201개와 분리된 합성
          상품이다.
        </p>
        <form action={(formData) => void submitPrimaryOrder(formData)} className="stackForm">
          <label>
            정수 수량
            <input
              name="quantity"
              type="number"
              min="1"
              step="1"
              defaultValue={profile === "investorB" ? "3" : "5"}
            />
          </label>
          <label>
            자금 경로
            <select
              name="fundingMode"
              defaultValue={profile === "investorB" ? "USDC_CONVERSION" : "USD_LEDGER"}
            >
              <option value="USD_LEDGER">USD 고객장부</option>
              <option value="USDC_CONVERSION">USDC 수취 후 USD 귀속</option>
            </select>
          </label>
          <p>
            KRW 지정가 257,000원 · USD/KRW 1,380.3 · 2026-08-31 당일 유효 · T+2 확인 전 이전 잠금
          </p>
          <button type="submit" disabled={!readiness?.canPlaceNewOrder || !demoOrderAccount}>
            서명하고 1차 주문 접수
          </button>
          {!readiness?.canPlaceNewOrder ? (
            <small className="actionHint">
              상단 고객 준비 단계의 차단 사유를 먼저 해소해야 한다.
            </small>
          ) : null}
        </form>
        <div className="timelineList">
          {primaryOrders.length === 0 ? (
            <p className="emptyState">접수한 로컬 1차 주문이 없다.</p>
          ) : (
            primaryOrders.map((order) => (
              <div key={order.orderId}>
                <strong>
                  {order.shareQuantity}주 · {order.fundingMode}
                </strong>
                <span>{order.status}</span>
                <small>
                  체결 {order.filledQuantity} · 배분 {order.allocatedQuantity} · {order.tokenStatus}
                </small>
              </div>
            ))
          )}
        </div>
        {session?.localPrimaryScenario?.notices.map((notice) => (
          <small key={notice} className="panelCopy">
            {notice}
          </small>
        ))}
      </section>

      <section className="panel widePanel">
        <div className="panelHeading">
          <div>
            <p className="eyebrow">PRODUCT CANDIDATES</p>
            <h2>KOSPI 200 상품 후보</h2>
          </div>
          <strong>{products.length}개 등록</strong>
        </div>
        <input
          className="searchInput"
          aria-label="상품 검색"
          placeholder="종목명 또는 6자리 코드 검색"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="productGrid">
          {visibleProducts.map((product) => (
            <article className="productCard" key={product.securityId}>
              <div>
                <span>{product.securityId}</span>
                {product.representative && <em>대표 시연</em>}
              </div>
              <h3>{product.nameKo}</h3>
              <p>발행 · 24시간 거래 · 환매 모두 차단</p>
              <small>{product.blockingReasons[0]?.messageKo}</small>
            </article>
          ))}
        </div>
      </section>

      <section className="panelGrid">
        <article className="panel">
          <p className="eyebrow">COMPLAINT</p>
          <h2>민원 접수</h2>
          <form action={(formData) => void submitComplaint(formData)} className="stackForm">
            <label>
              민원 유형
              <select name="type" defaultValue="ACCOUNT">
                <option value="PLATFORM_TECHNICAL">플랫폼 기술문의</option>
                <option value="BROKERAGE_ACCOUNT">계좌 민원</option>
                <option value="TRADE_ERROR">거래오류</option>
                <option value="REGULATORY">규제 민원</option>
              </select>
            </label>
            <label>
              제목
              <input name="titleKo" required defaultValue="모의 계좌 처리 확인" />
            </label>
            <label>
              내용
              <textarea
                name="descriptionKo"
                required
                defaultValue="현재 모의 처리상태와 책임기관을 확인해 달라."
              />
            </label>
            <button type="submit">민원 접수</button>
          </form>
        </article>
        <article className="panel">
          <div className="panelHeading">
            <div>
              <p className="eyebrow">MY COMPLAINTS</p>
              <h2>처리 현황</h2>
            </div>
            <button className="subtleButton" type="button" onClick={() => void refresh()}>
              새로고침
            </button>
          </div>
          <div className="timelineList">
            {complaints.length === 0 ? (
              <p className="emptyState">접수된 민원이 없다.</p>
            ) : (
              complaints.map((complaint) => (
                <div key={complaint.complaintId}>
                  <strong>{complaint.titleKo}</strong>
                  <span>{complaint.status}</span>
                  <small>{complaint.responsibleInstitutionId ?? "책임기관 배정 전"}</small>
                </div>
              ))
            )}
          </div>
        </article>
      </section>
    </div>
  );
}

function StatusCard({ label, value }: { label: string; value: string }) {
  return (
    <article className="metricCard">
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}
