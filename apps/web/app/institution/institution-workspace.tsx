"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { keccak256, padHex, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import {
  allProducts,
  platformFetch,
  type Complaint,
  type Product,
  type PrimaryOrder,
  type MarketMakerHedge,
  type MarketMakerPosition,
  type SecondaryOrder,
  type Session,
  type Workflow,
} from "../lib/platform-api";

const brokerToken = "demo:broker-operator";
const platformInstitution = "00000000-0000-4000-8000-000000000201";
const brokerInstitution = "00000000-0000-4000-8000-000000000202";

export function InstitutionWorkspace() {
  const [products, setProducts] = useState<Product[]>([]);
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [tasks, setTasks] = useState<Workflow[]>([]);
  const [primaryOrders, setPrimaryOrders] = useState<PrimaryOrder[]>([]);
  const [secondaryOrders, setSecondaryOrders] = useState<SecondaryOrder[]>([]);
  const [positions, setPositions] = useState<MarketMakerPosition[]>([]);
  const [hedges, setHedges] = useState<MarketMakerHedge[]>([]);
  const [session, setSession] = useState<Session>();
  const [message, setMessage] = useState("기관 대기열을 불러오는 중이다.");
  const marketMakerAccount = useMemo(
    () => privateKeyToAccount(keccak256(toHex("SECONDARY-DEMO-MM"))),
    [],
  );
  const brokerAccount = useMemo(
    () => privateKeyToAccount(keccak256(toHex("SECONDARY-BROKER"))),
    [],
  );

  const refresh = useCallback(async () => {
    try {
      const [
        productItems,
        complaintPage,
        taskPage,
        orderPage,
        secondaryPage,
        positionPage,
        hedgePage,
        nextSession,
      ] = await Promise.all([
        allProducts(),
        platformFetch<{ items: Complaint[] }>("/complaints", { token: brokerToken }),
        platformFetch<{ items: Workflow[] }>("/institution/tasks", { token: brokerToken }),
        platformFetch<{ items: PrimaryOrder[] }>("/primary-orders", { token: brokerToken }),
        platformFetch<{ items: SecondaryOrder[] }>("/secondary-orders", { token: brokerToken }),
        platformFetch<{ items: MarketMakerPosition[] }>("/market-maker/positions", {
          token: brokerToken,
        }),
        platformFetch<{ items: MarketMakerHedge[] }>("/market-maker/hedges", {
          token: brokerToken,
        }),
        platformFetch<Session>("/session", { token: brokerToken }),
      ]);
      setProducts(productItems);
      setComplaints(complaintPage.items);
      setTasks(taskPage.items);
      setPrimaryOrders(orderPage.items);
      setSecondaryOrders(secondaryPage.items);
      setPositions(positionPage.items);
      setHedges(hedgePage.items);
      setSession(nextSession);
      setMessage("최신 모의 투영을 확인했다.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "조회에 실패했다.");
    }
  }, []);

  async function decideHedge(hedge: MarketMakerHedge) {
    if (!session?.localSecondaryScenario) throw new Error("헤지 서명정보가 없다.");
    try {
      if (hedge.status === "HEDGE_CREATED") {
        const expiresAt = String(Math.floor(Date.now() / 1000) + 3600);
        const nonce = String(Date.now());
        let signedHedgeIntent: unknown;
        if (hedge.direction === "BUY") {
          const quantity = BigInt(hedge.requestedQuantity);
          const krwLimitPrice = BigInt(hedge.krwLimitPrice);
          const fundingAmountMinor = (
            (quantity * krwLimitPrice * 1000n + 13_802n) /
            13_803n
          ).toString();
          const message = {
            orderId: hedge.hedgeId,
            investor: marketMakerAccount.address,
            securityId: hedge.securityId,
            shareQuantity: hedge.requestedQuantity,
            krwLimitPrice: hedge.krwLimitPrice,
            targetTradingDate: hedge.targetTradingDate,
            fundingMode: "USD_LEDGER",
            fundingAmountMinor,
            nonce,
            expiresAt,
            policyVersion: keccak256(toHex(session.localSecondaryScenario.policyVersion)),
          };
          const signature = await marketMakerAccount.signTypedData({
            domain: session.localSecondaryScenario.intentDomain,
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
              orderId: `0x${hedge.hedgeId.replaceAll("-", "")}` as `0x${string}`,
              shareQuantity: quantity,
              krwLimitPrice,
              fundingAmountMinor: BigInt(fundingAmountMinor),
              nonce: BigInt(nonce),
              expiresAt: BigInt(expiresAt),
            },
          });
          signedHedgeIntent = {
            domain: session.localSecondaryScenario.intentDomain,
            primaryType: "PrimaryOrderIntent",
            message,
            signer: marketMakerAccount.address,
            signature,
          };
        } else {
          const message = {
            redemptionId: hedge.hedgeId,
            investor: marketMakerAccount.address,
            token: session.localSecondaryScenario.tokenAddress,
            shareQuantity: hedge.requestedQuantity,
            krwLimitPrice: hedge.krwLimitPrice,
            targetTradingDate: hedge.targetTradingDate,
            nonce,
            expiresAt,
            policyVersion: keccak256(toHex(session.localSecondaryScenario.policyVersion)),
          };
          const signature = await marketMakerAccount.signTypedData({
            domain: session.localSecondaryScenario.intentDomain,
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
              redemptionId: `0x${hedge.hedgeId.replaceAll("-", "")}` as `0x${string}`,
              shareQuantity: BigInt(hedge.requestedQuantity),
              krwLimitPrice: BigInt(hedge.krwLimitPrice),
              nonce: BigInt(nonce),
              expiresAt: BigInt(expiresAt),
            },
          });
          signedHedgeIntent = {
            domain: session.localSecondaryScenario.intentDomain,
            primaryType: "RedemptionIntent",
            message,
            signer: marketMakerAccount.address,
            signature,
          };
        }
        await platformFetch(`/market-maker/hedges/${hedge.hedgeId}/decisions`, {
          token: "demo:market-maker",
          method: "POST",
          body: {
            decision: "APPROVE",
            reasonKo: "시장조성자가 다음 KRX 개장 헤지 주문을 확인했다.",
            expectedAggregateVersion: hedge.aggregateVersion,
            signedHedgeIntent,
          },
        });
        setMessage("시장조성자 헤지 확인과 주문 서명을 접수했다.");
      } else if (hedge.status === "HEDGE_RISK_REVIEW") {
        await platformFetch(`/market-maker/hedges/${hedge.hedgeId}/decisions`, {
          token: brokerToken,
          method: "POST",
          body: {
            decision: "APPROVE",
            reasonKo: "외국인 한도, 거래상태와 위험한도를 확인했다.",
            expectedAggregateVersion: hedge.aggregateVersion,
          },
        });
        setMessage("해외 증권사의 헤지 위험승인을 접수했다.");
      }
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "헤지 결정 접수에 실패했다.");
    }
  }

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function advanceComplaint(complaint: Complaint) {
    let suffix: string;
    let body: Record<string, string>;
    if (complaint.status === "SUBMITTED") {
      suffix = "assignments";
      body = {
        responsibleInstitutionId:
          complaint.type === "PLATFORM_TECHNICAL" ? platformInstitution : brokerInstitution,
        reasonKo: "민원 유형에 따라 모의 책임기관을 배정한다.",
      };
    } else if (complaint.status === "ASSIGNED") {
      suffix = "processing-starts";
      body = { reasonKo: "담당자가 처리를 시작한다." };
    } else if (complaint.status === "IN_PROGRESS") {
      suffix = "responses";
      body = { responseReferenceId: crypto.randomUUID(), reasonKo: "모의 답변을 기록한다." };
    } else if (complaint.status === "RESPONSE_RECORDED") {
      suffix = "correction-links";
      body = { correctionWorkflowId: crypto.randomUUID(), reasonKo: "정정 검토 업무를 연결한다." };
    } else {
      suffix = "closures";
      body = { closedAt: new Date().toISOString(), reasonKo: "처리 증거 확인 후 종결한다." };
    }
    try {
      const actionToken =
        complaint.type === "PLATFORM_TECHNICAL" ? "demo:platform-operator" : brokerToken;
      await platformFetch(`/institution/complaints/${complaint.complaintId}/${suffix}`, {
        token: actionToken,
        method: "POST",
        body,
      });
      setMessage(`${complaint.titleKo}의 다음 처리단계를 접수했다.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "기관 처리 접수에 실패했다.");
    }
  }

  async function decideTask(task: Workflow, decision: "APPROVE" | "REJECT") {
    try {
      const state = task.states[0]?.code;
      if (task.workflowType === "SECONDARY_TRADE") {
        const order = secondaryOrders.find((item) => item.orderId === task.workflowId);
        if (!order) throw new Error("정산할 24시간 주문을 찾을 수 없다.");
        let signedSettlementApproval: unknown;
        if (decision === "APPROVE") {
          if (!session?.localSecondaryScenario) throw new Error("24시간 거래 서명정보가 없다.");
          const approvalId = crypto.randomUUID();
          const expiresAt = String(Math.floor(Date.now() / 1000) + 3600);
          const approval = {
            approvalId,
            orderId: order.orderId,
            investor: order.investorWallet,
            marketMaker: order.marketMakerWallet,
            token: order.tokenAddress,
            paymentMode: order.fundingMode,
            paymentAssetId: order.paymentAssetId,
            shareQuantity: order.fillQuantity,
            paymentAmountMinor: order.paymentAmountMinor,
            rightsEvidenceHash: keccak256(toHex(`rights:${order.orderId}`)),
            fundsEvidenceHash: keccak256(toHex(`funds:${order.orderId}`)),
            nonce: String(Date.now()),
            expiresAt,
            policyVersion: keccak256(toHex(session.localSecondaryScenario.policyVersion)),
          };
          const signature = await brokerAccount.signTypedData({
            domain: session.localSecondaryScenario.intentDomain,
            types: {
              BrokerSettlementApproval: [
                { name: "approvalId", type: "bytes16" },
                { name: "orderId", type: "bytes16" },
                { name: "investor", type: "address" },
                { name: "marketMaker", type: "address" },
                { name: "token", type: "address" },
                { name: "paymentMode", type: "string" },
                { name: "paymentAssetId", type: "bytes32" },
                { name: "shareQuantity", type: "uint256" },
                { name: "paymentAmountMinor", type: "uint256" },
                { name: "rightsEvidenceHash", type: "bytes32" },
                { name: "fundsEvidenceHash", type: "bytes32" },
                { name: "nonce", type: "uint256" },
                { name: "expiresAt", type: "uint256" },
                { name: "policyVersion", type: "bytes32" },
              ],
            },
            primaryType: "BrokerSettlementApproval",
            message: {
              ...approval,
              approvalId: `0x${approvalId.replaceAll("-", "")}` as `0x${string}`,
              orderId: `0x${order.orderId.replaceAll("-", "")}` as `0x${string}`,
              shareQuantity: BigInt(order.fillQuantity),
              paymentAmountMinor: BigInt(order.paymentAmountMinor),
              nonce: BigInt(approval.nonce),
              expiresAt: BigInt(expiresAt),
            },
          });
          signedSettlementApproval = {
            domain: session.localSecondaryScenario.intentDomain,
            primaryType: "BrokerSettlementApproval",
            message: approval,
            signer: brokerAccount.address,
            signature,
          };
        }
        await platformFetch(`/institution/tasks/${task.workflowId}/decisions`, {
          token: brokerToken,
          method: "POST",
          body: {
            decision,
            reasonKo:
              decision === "APPROVE"
                ? "예약된 권리와 자금 증거를 확인했다."
                : "정산 증거가 부족하다.",
            expectedAggregateVersion: 1,
            ...(signedSettlementApproval ? { signedSettlementApproval } : {}),
          },
        });
        setMessage("해외 증권사의 24시간 정산 결정을 접수했다.");
        return;
      }
      const tokenByState: Record<string, string> = {
        AWAITING_KRX_EXECUTION: "demo:execution-confirmer",
        T2_RISK_APPROVAL_PENDING: "demo:risk-approver",
        RIGHTS_ENTRY_APPROVAL_PENDING: "demo:rights-approver",
        RIGHTS_RECORDING_PENDING: "demo:rights-recorder",
        SETTLEMENT_AND_CUSTODY_PENDING: "demo:settlement-confirmer",
      };
      const primaryOrder = primaryOrders.find((order) => order.orderId === task.workflowId);
      if (
        state === "SETTLEMENT_AND_CUSTODY_PENDING" &&
        primaryOrder?.settlementStatus === "DOMESTIC_SETTLEMENT_CONFIRMED"
      )
        tokenByState[state] = "demo:custody-confirmer";
      await platformFetch(`/institution/tasks/${task.workflowId}/decisions`, {
        token: tokenByState[state ?? ""] ?? brokerToken,
        method: "POST",
        body: {
          decision,
          reasonKo:
            decision === "APPROVE"
              ? "합성 계좌와 고객 판정을 확인했다."
              : "필수 확인자료가 부족하다.",
          expectedAggregateVersion: 1,
          ...(state === "AWAITING_KRX_EXECUTION" ? { filledQuantity: "6" } : {}),
        },
      });
      setMessage(
        `기관 업무 ${task.workflowId.slice(0, 8)}의 ${decision === "APPROVE" ? "승인" : "거절"}을 접수했다.`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "기관 결정 접수에 실패했다.");
    }
  }

  async function publishSecondaryQuote(formData: FormData) {
    if (!session?.localSecondaryScenario) return;
    try {
      const side = String(formData.get("side")) as "BUY" | "SELL";
      const fundingMode = String(formData.get("fundingMode")) as "USD_LEDGER" | "USDC_ONCHAIN";
      const quantity = String(formData.get("quantity"));
      const unitPriceMinor = String(formData.get("unitPriceMinor"));
      const quoteId = crypto.randomUUID();
      const quoteBaseTime = new Date(session.projection.projectionAsOf).getTime();
      const expiresAtDate = new Date(quoteBaseTime + 30_000);
      const expiresAt = String(Math.floor(expiresAtDate.getTime() / 1000));
      const paymentAssetId =
        fundingMode === "USD_LEDGER"
          ? keccak256(toHex("USD_LEDGER"))
          : padHex(session.localSecondaryScenario.mockUsdcAddress, { size: 32 });
      const quote = {
        quoteId,
        marketMaker: marketMakerAccount.address,
        token: session.localSecondaryScenario.tokenAddress,
        marketMakerSide: side,
        paymentMode: fundingMode,
        paymentAssetId,
        shareQuantity: quantity,
        unitPriceMinor,
        nonce: String(Date.now()),
        expiresAt,
        policyVersion: keccak256(toHex(session.localSecondaryScenario.policyVersion)),
      };
      const signature = await marketMakerAccount.signTypedData({
        domain: session.localSecondaryScenario.intentDomain,
        types: {
          MarketMakerQuote: [
            { name: "quoteId", type: "bytes16" },
            { name: "marketMaker", type: "address" },
            { name: "token", type: "address" },
            { name: "marketMakerSide", type: "string" },
            { name: "paymentMode", type: "string" },
            { name: "paymentAssetId", type: "bytes32" },
            { name: "shareQuantity", type: "uint256" },
            { name: "unitPriceMinor", type: "uint256" },
            { name: "nonce", type: "uint256" },
            { name: "expiresAt", type: "uint256" },
            { name: "policyVersion", type: "bytes32" },
          ],
        },
        primaryType: "MarketMakerQuote",
        message: {
          ...quote,
          quoteId: `0x${quoteId.replaceAll("-", "")}` as `0x${string}`,
          shareQuantity: BigInt(quantity),
          unitPriceMinor: BigInt(unitPriceMinor),
          nonce: BigInt(quote.nonce),
          expiresAt: BigInt(expiresAt),
        },
      });
      await platformFetch("/market-maker/quotes", {
        token: "demo:market-maker",
        method: "POST",
        body: {
          securityId: session.localSecondaryScenario.securityId,
          marketMakerSide: side,
          fundingMode,
          shareQuantity: quantity,
          unitPrice: {
            currency: fundingMode === "USD_LEDGER" ? "USD" : "USDC",
            amountMinor: unitPriceMinor,
            decimals: fundingMode === "USD_LEDGER" ? 2 : 6,
          },
          expiresAt: expiresAtDate.toISOString(),
          signedQuote: {
            domain: session.localSecondaryScenario.intentDomain,
            primaryType: "MarketMakerQuote",
            message: quote,
            signer: marketMakerAccount.address,
            signature,
          },
        },
      });
      setMessage("지정 시장조성자 호가를 게시했다. 30초 안에만 체결할 수 있다.");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "호가 게시에 실패했다.");
    }
  }

  async function resolveSettlementDefault(
    order: PrimaryOrder,
    action: "QUARANTINE_DEFAULT" | "APPROVE_REPLACEMENT_SHARES" | "APPROVE_CASH_COMPENSATION",
  ) {
    try {
      const institutionApprovedAmount =
        action === "APPROVE_CASH_COMPENSATION"
          ? window.prompt("인가 해외 증권사가 승인한 현금보상액을 USD 센트 정수로 입력한다.")
          : undefined;
      if (
        action === "APPROVE_CASH_COMPENSATION" &&
        !/^[1-9][0-9]*$/.test(institutionApprovedAmount ?? "")
      ) {
        setMessage("기관 승인 현금보상액 입력을 취소했거나 값이 올바르지 않다.");
        return;
      }
      await platformFetch(`/institution/tasks/${order.orderId}/decisions`, {
        token: brokerToken,
        method: "POST",
        body: {
          decision: "APPROVE",
          action,
          reasonKo:
            action === "QUARANTINE_DEFAULT"
              ? "모의 국내 결제불이행을 격리하고 기관 처리안을 요청한다."
              : action === "APPROVE_REPLACEMENT_SHARES"
                ? "인가 해외 증권사가 대체주식 조달을 승인했다."
                : "인가 해외 증권사가 약관상 현금보상액을 직접 승인했다.",
          ...(action === "APPROVE_CASH_COMPENSATION"
            ? { cashCompensationUsdMinor: institutionApprovedAmount }
            : {}),
        },
      });
      setMessage(
        "결제불이행 처리 결정을 접수했다. 금액은 플랫폼 계산값이 아닌 모의 기관 승인값이다.",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "결제불이행 처리에 실패했다.");
    }
  }

  const representative = products.filter((product) => product.representative);
  return (
    <div className="workspaceContent">
      <section className="workspaceIntro">
        <div>
          <p className="eyebrow">INSTITUTION CONTROL</p>
          <h1>통합 기관 콘솔</h1>
          <p>화면상 역할 전환은 실제 권한을 부여하지 않는다. 승인과 실행 증거는 분리해 남긴다.</p>
        </div>
        <span className="roleCard">
          역할별 업무공간<strong>해외 증권사 및 토큰 플랫폼</strong>
        </span>
      </section>
      <div className="noticeBar" role="status">
        모의 환경 · {message}
      </div>

      <section className="metricGrid">
        <article className="metricCard">
          <span>상품 후보</span>
          <strong>{products.length || "-"}</strong>
        </article>
        <article className="metricCard">
          <span>대표 시연 종목</span>
          <strong>{representative.length || "-"}</strong>
        </article>
        <article className="metricCard">
          <span>거래 활성 종목</span>
          <strong>0</strong>
        </article>
        <article className="metricCard">
          <span>지갑·예외 대기</span>
          <strong>{tasks.length}</strong>
        </article>
      </section>

      <section className="panelGrid">
        <article className="panel">
          <div className="panelHeading">
            <div>
              <p className="eyebrow">MARKET MAKER QUOTE</p>
              <h2>24/7 지정가 호가</h2>
            </div>
            <span className="statePill">30초 유효</span>
          </div>
          <form action={(formData) => void publishSecondaryQuote(formData)} className="stackForm">
            <label>
              MM 방향
              <select name="side" defaultValue="SELL">
                <option value="SELL">투자자에게 매도</option>
                <option value="BUY">투자자로부터 매수</option>
              </select>
            </label>
            <label>
              자금 경로
              <select name="fundingMode" defaultValue="USDC_ONCHAIN">
                <option value="USDC_ONCHAIN">시험 USDC DvP</option>
                <option value="USD_LEDGER">USD 고객장부</option>
              </select>
            </label>
            <label>
              정수 수량
              <input name="quantity" type="number" min="1" step="1" defaultValue="5" />
            </label>
            <label>
              가격 최소단위
              <input name="unitPriceMinor" inputMode="numeric" defaultValue="1203550000" />
            </label>
            <button type="submit">시장조성자 지갑으로 서명·게시</button>
          </form>
          <p className="panelCopy">
            USDC는 6자리, USD는 2자리 최소단위다. 정상 매도호가는 각각 1,203,550,000과 120,355다.
          </p>
        </article>
        <article className="panel">
          <div className="panelHeading">
            <div>
              <p className="eyebrow">POSITION CONTROL</p>
              <h2>재고와 순포지션</h2>
            </div>
            <span className="statePill">결제완료만 사용</span>
          </div>
          <div className="timelineList">
            {positions.map((position) => (
              <div key={position.securityId}>
                <strong>
                  재고 {position.settledInventory}주 · 순포지션 {position.netPosition}주
                </strong>
                <span>한도 ±{position.positionLimit}</span>
                <small>
                  결제 대기 {position.pendingInventory} · 예약 {position.reservedInventory} · 손실{" "}
                  {position.securityLossBps}bp
                </small>
                <small>
                  다음 세션 시작재고 {position.nextSessionStartingInventory} ·{" "}
                  {position.riskReducingOnly
                    ? `${position.quoteDirectionBlocked ?? "위험증가"} 방향 호가 차단`
                    : "양방향 호가 가능"}
                </small>
                {position.hedgeHoldReasonKo ? <em>{position.hedgeHoldReasonKo}</em> : null}
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="panel widePanel">
        <div className="panelHeading">
          <div>
            <p className="eyebrow">NEXT KRX OPEN HEDGE</p>
            <h2>시장조성자 헤지와 재고조정</h2>
          </div>
          <span className="statePill">모의 KRX · T+2</span>
        </div>
        <div className="complaintTable" role="table" aria-label="시장조성자 헤지 대기열">
          {hedges.length === 0 ? (
            <p className="emptyState">완료된 24시간 거래에서 생성된 헤지가 없다.</p>
          ) : (
            hedges.map((hedge) => (
              <div className="complaintRow" role="row" key={hedge.hedgeId}>
                <div>
                  <small>
                    {hedge.securityId} ·{" "}
                    {hedge.direction === "BUY" ? "기초주식 매수" : "기초주식 매도"}
                  </small>
                  <strong>
                    요청 {hedge.requestedQuantity}주 · 체결 {hedge.filledQuantity}주 · 잔량{" "}
                    {hedge.remainingQuantity}주
                  </strong>
                </div>
                <span>{hedge.status}</span>
                <small>
                  다음 개장일 {hedge.targetTradingDate} · 원인 거래{" "}
                  {hedge.sourceSecondaryOrderIds.length}건 · 외국인 한도 {hedge.foreignLimitStatus}
                </small>
                <small>
                  MM 확인 {hedge.marketMakerConfirmed ? "완료" : "대기"} · 위험승인{" "}
                  {hedge.brokerRiskApproved ? "완료" : "대기"} · 국내결제{" "}
                  {hedge.domesticSettlementConfirmed ? "완료" : "대기"} · 수탁{" "}
                  {hedge.direction === "SELL"
                    ? hedge.usdPaymentConfirmed
                      ? "USD 지급 완료"
                      : "USD 지급 대기"
                    : hedge.custodyQuantityConfirmed
                      ? "확인 완료"
                      : "확인 대기"}
                </small>
                <small>
                  최근 이력{" "}
                  {hedge.history
                    .slice(-3)
                    .map((item) => item.state)
                    .join(" → ") || "생성 대기"}
                </small>
                {hedge.status === "HEDGE_CREATED" || hedge.status === "HEDGE_RISK_REVIEW" ? (
                  <button type="button" onClick={() => void decideHedge(hedge)}>
                    {hedge.status === "HEDGE_CREATED"
                      ? "MM 주문 서명·확인"
                      : "해외 증권사 위험승인"}
                  </button>
                ) : (
                  <em>{hedge.holdReasonKo ?? "모의 기관 결과 또는 다음 단계 대기"}</em>
                )}
              </div>
            ))
          )}
        </div>
        <p className="panelCopy">
          순매도는 다음 KRX 개장 때 기초주식 매수, 순매수는 기초주식 매도로 연결한다. 국내
          부분체결분만 T+2와 재고에 반영하고 잔량은 같은 헤지에 보류한다.
        </p>
      </section>

      <section className="panel widePanel">
        <div className="panelHeading">
          <div>
            <p className="eyebrow">SECONDARY SETTLEMENT</p>
            <h2>24/7 정산 결과</h2>
          </div>
          <span className="statePill">권리 · 토큰 · 자금</span>
        </div>
        <div className="complaintTable">
          {secondaryOrders.length === 0 ? (
            <p className="emptyState">접수된 24시간 주문이 없다.</p>
          ) : (
            secondaryOrders.map((order) => (
              <div className="complaintRow" key={order.orderId}>
                <div>
                  <small>{order.fundingMode}</small>
                  <strong>
                    {order.requestedQuantity}주 중 {order.fillQuantity}주
                  </strong>
                </div>
                <span>{order.status}</span>
                <small>
                  체인 {order.chainFinalized ? "확정" : "대기"} · 권리{" "}
                  {order.rightsFinalized ? "확정" : "대기"} · 자금{" "}
                  {order.fundsFinalized ? "확정" : "대기"}
                </small>
                <em>
                  {order.quarantineReason ?? `미체결 ${order.cancelledQuantity}주 주문·예약 해제`}
                </em>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="panel widePanel">
        <div className="panelHeading">
          <div>
            <p className="eyebrow">INSTITUTION TASKS</p>
            <h2>1차 발행 승인과 예외 대기열</h2>
          </div>
          <span className="statePill">권한 분리</span>
        </div>
        <div className="complaintTable" role="table" aria-label="지갑 승인 대기열">
          {tasks.length === 0 ? (
            <p className="emptyState">대기 중인 지갑 업무가 없다.</p>
          ) : (
            tasks.map((task) => (
              <div className="complaintRow" role="row" key={task.workflowId}>
                <div>
                  <small>{task.workflowType}</small>
                  <strong>{task.workflowId.slice(0, 13)}…</strong>
                </div>
                <span>{task.states[0]?.code}</span>
                <small>
                  {task.workflowType.startsWith("PRIMARY_")
                    ? "각 단계의 독립 증거와 역할을 확인"
                    : "기관 승인 뒤 체인 반영 필요"}
                </small>
                {task.states[0]?.code === "PENDING_APPROVAL" ||
                task.workflowType.startsWith("PRIMARY_") ||
                task.workflowType === "SECONDARY_TRADE" ? (
                  <div className="buttonGroup">
                    <button type="button" onClick={() => void decideTask(task, "APPROVE")}>
                      승인 접수
                    </button>
                    <button
                      className="subtleButton"
                      type="button"
                      onClick={() => void decideTask(task, "REJECT")}
                    >
                      거절
                    </button>
                  </div>
                ) : (
                  <em>사람 검토</em>
                )}
              </div>
            ))
          )}
        </div>
      </section>

      <section className="panel widePanel">
        <div className="panelHeading">
          <div>
            <p className="eyebrow">PRIMARY ISSUANCE</p>
            <h2>로컬 1차 발행 진행</h2>
          </div>
          <span className="statePill">모의 KRX · KSD · 수탁</span>
        </div>
        <div className="complaintTable">
          {primaryOrders.length === 0 ? (
            <p className="emptyState">접수된 로컬 주문이 없다.</p>
          ) : (
            primaryOrders.map((order) => (
              <div className="complaintRow" key={order.orderId}>
                <div>
                  <small>
                    {order.securityId} · {order.fundingMode}
                  </small>
                  <strong>{order.shareQuantity}주 주문</strong>
                </div>
                <span>{order.status}</span>
                <small>
                  체결 {order.filledQuantity} · 배분 {order.allocatedQuantity}
                </small>
                <div>
                  <em>{order.tokenStatus}</em>
                  {order.status === "SETTLEMENT_AND_CUSTODY_PENDING" ? (
                    <button
                      className="subtleButton"
                      type="button"
                      onClick={() => void resolveSettlementDefault(order, "QUARANTINE_DEFAULT")}
                    >
                      결제불이행 격리
                    </button>
                  ) : null}
                  {order.status === "QUARANTINED" ? (
                    <div className="buttonGroup">
                      <button
                        type="button"
                        onClick={() =>
                          void resolveSettlementDefault(order, "APPROVE_REPLACEMENT_SHARES")
                        }
                      >
                        대체주식 승인
                      </button>
                      <button
                        className="subtleButton"
                        type="button"
                        onClick={() =>
                          void resolveSettlementDefault(order, "APPROVE_CASH_COMPENSATION")
                        }
                      >
                        기관 현금보상 승인
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            ))
          )}
        </div>
        <p className="panelCopy">
          결제와 수탁은 별도 담당자가 각각 확인해야 한다. 첫 확인 뒤에도 같은 단계가 남으며, 다음
          새로고침에서 수탁 담당 확인을 선택할 수 있다.
        </p>
      </section>

      <section className="panelGrid">
        <article className="panel">
          <div className="panelHeading">
            <div>
              <p className="eyebrow">REFERENCE DATA</p>
              <h2>상품 후보 통제</h2>
            </div>
            <span className="statePill">전체 차단</span>
          </div>
          <p className="panelCopy">
            201개 종목은 기준정보 후보로만 등록됐다. 공식 ISIN, 수탁 지원과 판매정책 확인 전에는
            활성화할 수 없다.
          </p>
          <div className="compactList">
            {representative.map((product) => (
              <div key={product.securityId}>
                <span>{product.securityId}</span>
                <strong>{product.nameKo}</strong>
                <small>INFORMATION UNCONFIRMED</small>
              </div>
            ))}
          </div>
        </article>

        <article className="panel">
          <div className="panelHeading">
            <div>
              <p className="eyebrow">WALLET CONTROL</p>
              <h2>지갑 승인 경계</h2>
            </div>
            <span className="statePill">Safe + 60초 지연</span>
          </div>
          <ol className="controlSteps">
            <li>고객이 브라우저에서 소유확인 서명</li>
            <li>인가 해외 증권사가 계좌와 판정 확인</li>
            <li>지연 실행으로 운영 역할 확인</li>
            <li>적격성 레지스트리 반영 후 연결 완료</li>
          </ol>
          <p className="panelCopy">
            교체 요청은 기존 지갑부터 동결하고 잔액 복구는 후속 기능에서 실행한다.
          </p>
        </article>
      </section>

      <section className="panel widePanel">
        <div className="panelHeading">
          <div>
            <p className="eyebrow">COMPLAINT QUEUE</p>
            <h2>민원 처리 대기열</h2>
          </div>
          <button className="subtleButton" type="button" onClick={() => void refresh()}>
            새로고침
          </button>
        </div>
        <div className="complaintTable" role="table" aria-label="민원 처리 대기열">
          {complaints.length === 0 ? (
            <p className="emptyState">접수된 민원이 없다.</p>
          ) : (
            complaints.map((complaint) => (
              <div className="complaintRow" role="row" key={complaint.complaintId}>
                <div>
                  <small>{complaint.type}</small>
                  <strong>{complaint.titleKo}</strong>
                </div>
                <span>{complaint.status}</span>
                <small>{complaint.responsibleInstitutionId ?? "배정 전"}</small>
                {complaint.status === "CLOSED" ? (
                  <em>종결</em>
                ) : (
                  <button type="button" onClick={() => void advanceComplaint(complaint)}>
                    다음 단계 접수
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
