"use client";

import { walletOwnershipMessage } from "@rwa/domain/protection";
import { useCallback, useEffect, useMemo, useState } from "react";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import {
  allProducts,
  demoTokens,
  platformFetch,
  type Complaint,
  type Consent,
  type Disclosure,
  type Product,
  type Session,
} from "../lib/platform-api";

const profileLabels = { valid: "허용 고객", denied: "거절 고객", expired: "만료 고객" };

export function InvestorWorkspace() {
  const [profile, setProfile] = useState<keyof typeof demoTokens>("valid");
  const [session, setSession] = useState<Session>();
  const [disclosure, setDisclosure] = useState<Disclosure>();
  const [consent, setConsent] = useState<Consent>();
  const [products, setProducts] = useState<Product[]>([]);
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("데이터를 불러오는 중이다.");
  const token = demoTokens[profile];

  const refresh = useCallback(async () => {
    try {
      const [nextSession, nextDisclosure, nextConsent, productItems, complaintPage] =
        await Promise.all([
          platformFetch<Session>("/session", { token }),
          platformFetch<Disclosure>("/disclosures/current"),
          platformFetch<Consent>("/disclosure-consents/current", { token }),
          allProducts(),
          platformFetch<{ items: Complaint[] }>("/complaints", { token }),
        ]);
      setSession(nextSession);
      setDisclosure(nextDisclosure);
      setConsent(nextConsent);
      setProducts(productItems);
      setComplaints(complaintPage.items);
      setMessage("모의 기준정보와 고객 상태를 확인했다.");
    } catch (error) {
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
      const account = privateKeyToAccount(generatePrivateKey());
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

  const readiness = session?.customerReadiness;
  return (
    <div className="workspaceContent">
      <section className="workspaceIntro">
        <div>
          <p className="eyebrow">CUSTOMER READINESS</p>
          <h1>투자자 업무공간</h1>
          <p>합성 고객 판정부터 공시 동의, 전용 지갑과 상품 후보를 한 흐름으로 확인한다.</p>
        </div>
        <label className="profilePicker">
          합성 고객
          <select
            value={profile}
            onChange={(event) => setProfile(event.target.value as keyof typeof demoTokens)}
          >
            {Object.entries(profileLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </section>

      <div className="noticeBar" role="status">
        모의 환경 · {message}
      </div>

      <section className="metricGrid" aria-label="고객 준비상태">
        <StatusCard label="고객확인" value={readiness?.eligibility ?? "확인 중"} />
        <StatusCard label="투자자 보호" value={readiness?.investorProtection ?? "확인 중"} />
        <StatusCard label="전용 지갑" value={readiness?.wallet ?? "확인 중"} />
        <StatusCard label="신규 주문" value={readiness?.canPlaceNewOrder ? "가능" : "차단"} />
      </section>

      <section className="panelGrid">
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
          <ul className="reasonList">
            {readiness?.blockingReasons.map((reason) => (
              <li key={reason.code}>{reason.messageKo}</li>
            ))}
          </ul>
        </article>
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
