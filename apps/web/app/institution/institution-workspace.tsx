"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { keccak256, padHex, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { LifecycleGuide } from "../components/lifecycle-guide";
import {
  allProducts,
  platformFetch,
  type Complaint,
  type Product,
  type PrimaryOrder,
  type Redemption,
  type MarketMakerHedge,
  type MarketMakerPosition,
  type OperationalHold,
  type RegulatoryReport,
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
  const [redemptions, setRedemptions] = useState<Redemption[]>([]);
  const [holds, setHolds] = useState<OperationalHold[]>([]);
  const [reports, setReports] = useState<RegulatoryReport[]>([]);
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
        redemptionPage,
        holdPage,
        reportPage,
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
        platformFetch<{ items: Redemption[] }>("/redemptions", { token: brokerToken }),
        platformFetch<{ items: OperationalHold[] }>("/holds", { token: brokerToken }),
        platformFetch<{ items: RegulatoryReport[] }>("/regulatory-reports", {
          token: brokerToken,
        }),
      ]);
      setProducts(productItems);
      setComplaints(complaintPage.items);
      setTasks(taskPage.items);
      setPrimaryOrders(orderPage.items);
      setSecondaryOrders(secondaryPage.items);
      setPositions(positionPage.items);
      setHedges(hedgePage.items);
      setSession(nextSession);
      setRedemptions(redemptionPage.items);
      setHolds(holdPage.items);
      setReports(reportPage.items);
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
        SALE_PROCEEDS_SETTLEMENT_PENDING: "demo:settlement-confirmer",
        RIGHTS_TERMINATION_PENDING: "demo:rights-recorder",
        PAYMENT_AND_BURN_PENDING: "demo:broker-operator",
      };
      if (task.workflowType === "WALLET_REPLACEMENT") {
        tokenByState[state ?? ""] = session?.localRightsScenario?.recovery?.rights_approved
          ? "demo:compliance-auditor"
          : "demo:rights-approver";
      } else if (task.workflowType === "CORPORATE_ACTION") {
        tokenByState[state ?? ""] = Boolean(
          session?.localRightsScenario?.corporateAction?.rights_approved,
        )
          ? "demo:compliance-auditor"
          : "demo:rights-approver";
      } else if (task.workflowType === "DIVIDEND" || task.workflowType === "VOTING") {
        tokenByState[state ?? ""] = brokerToken;
      }
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
          ...(state === "AWAITING_KRX_EXECUTION"
            ? { filledQuantity: task.workflowType === "REDEMPTION_BATCH" ? "4" : "6" }
            : {}),
          ...(state === "PAYMENT_AND_BURN_PENDING" ? { action: "COMPLETE_BOTH" } : {}),
        },
      });
      setMessage(
        `기관 업무 ${task.workflowId.slice(0, 8)}의 ${decision === "APPROVE" ? "승인" : "거절"}을 접수했다.`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "기관 결정 접수에 실패했다.");
    }
  }

  async function runReconciliation() {
    try {
      await platformFetch("/reconciliations", {
        token: "demo:compliance-auditor",
        method: "POST",
        body: {
          securityId: session?.localRightsScenario?.securityId ?? "990001",
          scope: "SECURITY",
          asOf: session?.projection.projectionAsOf ?? new Date().toISOString(),
        },
      });
      setMessage("같은 기준시각의 두 축 대사를 접수했다.");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "대사 실행에 실패했다.");
    }
  }

  async function releaseHold(hold: OperationalHold) {
    try {
      await platformFetch(`/holds/${hold.workflowId}/release-decisions`, {
        token: "demo:compliance-auditor",
        method: "POST",
        body: { decision: "APPROVE", reasonKo: "원인 보정과 전체 재대사 일치를 독립 확인했다." },
      });
      setMessage("중지 해제 승인과 60초 지연 실행을 접수했다.");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "중지 해제 승인에 실패했다.");
    }
  }

  async function submitReport(
    report: RegulatoryReport,
    result: "ACCEPTED" | "CORRECTION_REQUIRED",
  ) {
    try {
      await platformFetch(`/regulatory-reports/${report.workflowId}/submission-results`, {
        token: brokerToken,
        method: "POST",
        body: {
          result,
          sourceMetadata: {
            sourceRecordId: `SIM-REPORT-${report.reportingMonth}-${result}`,
            simulation: true,
          },
        },
      });
      setMessage(
        "월별 보고 제출결과를 접수했다. 원본 개인정보와 본문은 공동 화면에 남기지 않는다.",
      );
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "보고 결과 기록에 실패했다.");
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
  const institutionSteps = [
    {
      id: "institution-customer",
      anchorId: "institution-protection",
      label: "고객 준비",
      stateCode: complaints.length ? "IN_PROGRESS" : "READY",
      detail: "적격성·공시·전용 지갑·민원",
      owner: "인가 해외 증권사·토큰 플랫폼",
      sourceRecord: "고객판정·공시동의·지갑 연결·민원 원기록",
      nextAction: complaints.length
        ? "민원 책임기관과 다음 처리단계를 확인한다."
        : "고객 판정과 최신 공시동의를 확인한다.",
    },
    {
      id: "institution-primary",
      label: "1차 발행",
      stateCode: primaryOrders.length ? "IN_PROGRESS" : "NOT_STARTED",
      detail: primaryOrders.length
        ? `${primaryOrders.length}건의 주문 상태 확인`
        : "투자자 주문 대기",
      owner: "해외 증권사·국내 증권사·수탁 담당",
      sourceRecord: "국내 체결·배분·위험승인·고객별 수탁권리 원장",
      nextAction: tasks.some((task) => task.workflowType.startsWith("PRIMARY_"))
        ? "발행 대기열의 다음 독립 증거를 승인한다."
        : "투자자 앱에서 1차 주문을 접수한다.",
    },
    {
      id: "institution-t2",
      anchorId: "institution-primary",
      label: "T+2 전환",
      stateCode: primaryOrders.some((order) => order.tokenStatus === "TRADABLE")
        ? "COMPLETED"
        : primaryOrders.length
          ? "WAITING_INSTITUTION"
          : "NOT_STARTED",
      detail: "국내 결제와 수탁수량을 독립 확인",
      owner: "KSD 모의 응답·수탁은행·상임대리인",
      sourceRecord: "국내 결제 기록·수탁수량 반영 기록",
      nextAction: "결제와 수탁 확인이 모두 있는지 대조한다.",
    },
    {
      id: "institution-secondary",
      label: "24/7 제한 거래",
      stateCode: secondaryOrders.length ? "IN_PROGRESS" : "NOT_STARTED",
      detail: secondaryOrders.length
        ? `${secondaryOrders.length}건의 제한 거래`
        : "지정 MM 호가부터 시작",
      owner: "지정 시장조성자와 인가 해외 증권사",
      sourceRecord: "MM 호가·고객별 수탁권리 원장·토큰·자금",
      nextAction: secondaryOrders.length
        ? "권리 원장 반영과 정산 결과를 확인한다."
        : "30초 유효 지정가 호가를 게시한다.",
    },
    {
      id: "institution-hedge",
      label: "시장조성자 헤지",
      stateCode: hedges.length ? "IN_PROGRESS" : "NOT_STARTED",
      detail: hedges.length ? `${hedges.length}건의 다음 개장일 헤지` : "완료된 24/7 체결 대기",
      owner: "시장조성자·해외 증권사·국내 증권사",
      sourceRecord: "순포지션·헤지 요청·국내 체결·T+2 재고",
      nextAction: hedges.length
        ? "시장조성자 확인과 위험 승인을 순서대로 처리한다."
        : "24/7 거래를 먼저 완결한다.",
    },
    {
      id: "institution-redemption",
      label: "환매",
      stateCode: redemptions.length ? "IN_PROGRESS" : "NOT_STARTED",
      detail: redemptions.length ? `${redemptions.length}건의 지급·소각 추적` : "투자자 요청 대기",
      owner: "해외 증권사와 국내 주문집행 증권사",
      sourceRecord: "환매 요청·국내 매도·USD 지급청구·소각",
      nextAction: "T+2, 권리종료, USD 지급과 소각을 각각 확인한다.",
    },
    {
      id: "institution-rights",
      label: "권리·대사·복구",
      stateCode: holds.length ? "ACTION_REQUIRED" : "READY",
      detail: holds.length ? `${holds.length}건의 중지 또는 보정 검토` : "두 축 대사 가능",
      owner: "권리 담당·준법·독립 감사",
      sourceRecord: "권리 스냅샷·두 축 대사·보정·승인 증거",
      nextAction: holds.length ? "중지 사유와 재개 조건을 확인한다." : "배당·보고·대사를 실행한다.",
      blocked: holds.length > 0,
    },
  ];
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
        <span>모의 환경 · {message}</span>
        <button className="subtleButton" type="button" onClick={() => void refresh()}>
          다시 불러오기
        </button>
      </div>

      <LifecycleGuide
        title="기관 간 인계 시연"
        description="각 단계에서 실행 주체, 승인 주체와 다음 행동을 분리해 보여준다. 화면 전환은 실제 권한을 바꾸지 않는다."
        steps={institutionSteps}
      />

      <nav className="roleWorkspaceNav" aria-label="기관 역할별 업무공간">
        <a href="#institution-primary">인가 해외 증권사 · 주문·권리·위험</a>
        <a href="#institution-secondary">지정 시장조성자 · 호가·재고·헤지</a>
        <a href="#institution-rights">수탁·권리 · 결제·기업행동</a>
        <a href="#institution-evidence">준법·감사 · 대사·격리·재개</a>
      </nav>

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

      <section className="panel widePanel" id="institution-evidence">
        <div className="panelHeading">
          <div>
            <p className="eyebrow">WORKFLOW EVIDENCE</p>
            <h2>업무 ID별 기관 인계와 기준 기록</h2>
          </div>
          <span>{tasks.length}건</span>
        </div>
        <p className="panelCopy">
          업무 ID를 기준으로 기관 요청과 승인 상태를 연결한다. 체인 성공만으로 고객 권리 원장이나
          자금 반영이 끝났다고 표시하지 않는다.
        </p>
        <div className="evidenceTimeline">
          {tasks.length === 0 ? (
            <p className="emptyState">아직 생성된 기관 업무가 없다.</p>
          ) : (
            tasks.slice(0, 12).map((task) => (
              <article key={task.workflowId}>
                <div>
                  <strong>{task.states.at(-1)?.labelKo ?? "상태 확인 대기"}</strong>
                  <code>{task.states.at(-1)?.code ?? "NO_STATE"}</code>
                </div>
                <p>{task.workflowType}</p>
                <small>업무 ID {task.workflowId}</small>
                <small>
                  기준 기록: 기관 요청 · 고객별 수탁권리 원장 · 토큰 · 자금 · 모의 기관 응답
                </small>
                <small>
                  오류 시: 영향범위 격리 → 원인 기록 보정 → 전체 재대사 → 독립 재개 승인
                </small>
              </article>
            ))
          )}
        </div>
      </section>

      <section className="panelGrid" id="institution-secondary">
        <article className="panel">
          <div className="panelHeading">
            <div>
              <p className="eyebrow">MARKET MAKER QUOTE</p>
              <h2>24/7 지정가 호가</h2>
            </div>
            <span className="statePill">30초 유효</span>
          </div>
          <form action={publishSecondaryQuote} className="stackForm">
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
            <button type="submit" disabled={!session?.localSecondaryScenario}>
              시장조성자 지갑으로 서명·게시
            </button>
            {!session?.localSecondaryScenario ? (
              <small className="actionHint">
                로컬 체인과 합성 시장조성자 시나리오가 준비돼야 게시할 수 있다.
              </small>
            ) : null}
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

      <section className="panel widePanel" id="institution-redemption">
        <div className="panelHeading">
          <div>
            <p className="eyebrow">REDEMPTION CONTROL</p>
            <h2>일반 투자자 환매·지급·소각</h2>
          </div>
          <span className="statePill">모의 KRX · USD 지급</span>
        </div>
        <div className="complaintTable">
          {redemptions.length === 0 ? (
            <p className="emptyState">접수된 일반 투자자 환매가 없다.</p>
          ) : (
            redemptions.map((item) => (
              <div className="complaintRow" key={item.redemptionId}>
                <div>
                  <small>{item.securityId} · 지정가 257,000원</small>
                  <strong>
                    요청 {item.requestedQuantity}주 · 체결배분 {item.allocatedQuantity}주
                  </strong>
                </div>
                <span>{item.status}</span>
                <small>
                  미체결 해제 {item.releasedQuantity}주 · 권리종료{" "}
                  {item.rightsTerminated ? "완료" : "대기"}
                </small>
                <small>
                  USD 청구 {item.cashClaimUsdMinor ?? "-"}센트 · 지급{" "}
                  {item.usdPaid ? "완료" : "대기"} · 소각 {item.tokenBurned ? "완료" : "대기"}
                </small>
                <em>{item.quarantineReasonKo ?? "실제 거래가 아닌 모의 기관 처리"}</em>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="panel widePanel" id="institution-hedge">
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
                  {hedge.sourceSecondaryOrderIds.length}건 · 생성 시 순포지션{" "}
                  {hedge.netPositionSnapshot}주 · 외국인 한도 {hedge.foreignLimitStatus}
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

      <section className="panel widePanel" id="institution-rights">
        <div className="panelHeading">
          <div>
            <p className="eyebrow">RIGHTS AND RECONCILIATION</p>
            <h2>권리업무·보고·두 축 대사</h2>
          </div>
          <button className="subtleButton" type="button" onClick={() => void runReconciliation()}>
            두 축 대사 실행
          </button>
        </div>
        <div className="panelGrid">
          <div className="timelineList">
            <div>
              <strong>현금배당</strong>
              <span>{session?.localRightsScenario?.dividend?.status ?? "검토 대기"}</span>
              <small>
                국내 수령총액 {session?.localRightsScenario?.dividend?.domesticTotalUsdMinor ?? "0"}
                센트 · 기준일과 국내 배정 증거 확인
              </small>
            </div>
            <div>
              <strong>의결권</strong>
              <span>{session?.localRightsScenario?.voting?.status ?? "수집 대기"}</span>
              <small>미응답은 미행사 · 해외 증권사 승인 뒤 상임대리인 모의 결과 기록</small>
            </div>
            <div>
              <strong>기업행동 990003</strong>
              <span>{session?.localRightsScenario?.corporateAction?.status ?? "검토 대기"}</span>
              <small>소각 대기 제외 2대1 합성 분할 · 예상 총발행량 19</small>
            </div>
            {session?.localRightsScenario?.recovery ? (
              <div>
                <strong>전용 지갑 복구</strong>
                <span>{session.localRightsScenario.recovery.status}</span>
                <small>
                  권리 승인 {session.localRightsScenario.recovery.rights_approved ? "완료" : "대기"}{" "}
                  · 준법 승인{" "}
                  {session.localRightsScenario.recovery.compliance_approved ? "완료" : "대기"}
                </small>
              </div>
            ) : null}
          </div>
          <div className="timelineList">
            {reports.map((report) => (
              <div key={report.workflowId}>
                <strong>{report.reportingMonth} 월별 보고</strong>
                <span>{report.states[0]?.code}</span>
                <small>
                  기한 {report.dueDate} · 보관증거 {report.retentionUntil}까지
                </small>
                <div className="buttonGroup">
                  <button type="button" onClick={() => void submitReport(report, "ACCEPTED")}>
                    정상 제출결과
                  </button>
                  <button
                    className="subtleButton"
                    type="button"
                    onClick={() => void submitReport(report, "CORRECTION_REQUIRED")}
                  >
                    정정 필요
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="complaintTable">
          {holds.length === 0 ? (
            <p className="emptyState">현재 업무 중지가 없다.</p>
          ) : (
            holds.map((hold) => (
              <div className="complaintRow" key={hold.workflowId}>
                <div>
                  <small>{hold.scope}</small>
                  <strong>{hold.reasonCode}</strong>
                </div>
                <span>{hold.states[0]?.code}</span>
                <small>{hold.securityId ?? "전체 신규 주문"}</small>
                {hold.states[0]?.code === "WORK_HALTED" ? (
                  <button type="button" onClick={() => void releaseHold(hold)}>
                    독립 재개 승인
                  </button>
                ) : (
                  <em>60초 지연 또는 해제 완료</em>
                )}
              </div>
            ))
          )}
        </div>
        <p className="panelCopy">
          고객별 수탁권리와 전체 발행토큰, 국내 결제완료 수탁수량과 결제완료 고객권리를 같은
          기준시각으로 각각 검사한다. 불일치 시 해당 종목의 신규 발행과 24시간 거래만 중지한다.
        </p>
      </section>

      <section className="panel widePanel">
        <div className="panelHeading">
          <div>
            <p className="eyebrow">INSTITUTION TASKS</p>
            <h2>기관 승인과 예외 대기열</h2>
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
                    : task.workflowType.startsWith("REDEMPTION")
                      ? "국내 매도, T+2, 권리종료와 지급·소각을 단계별 확인"
                      : "기관 승인 뒤 체인 반영 필요"}
                </small>
                {task.states[0]?.code === "PENDING_APPROVAL" ||
                task.workflowType.startsWith("PRIMARY_") ||
                task.workflowType.startsWith("REDEMPTION") ||
                task.workflowType === "SECONDARY_TRADE" ||
                ["DIVIDEND", "VOTING", "WALLET_REPLACEMENT", "CORPORATE_ACTION"].includes(
                  task.workflowType,
                ) ? (
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

      <section className="panel widePanel" id="institution-primary">
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

      <section className="panel widePanel" id="institution-protection">
        <div className="panelHeading">
          <div>
            <p className="eyebrow">CUSTOMER PROTECTION</p>
            <h2>고객 준비와 민원 책임기관</h2>
          </div>
          <span>{complaints.length}건 검토</span>
        </div>
        <p className="panelCopy">
          투자자 보호 판정과 위험공시 동의는 인가 해외 증권사의 기준 기록이다. 플랫폼 기술문의와
          계좌·거래·규제 민원은 책임기관을 나눠 처리한다.
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
            교체 요청은 기존 지갑부터 동결한다. 권리·준법 독립 승인, 체인 복구, 권리원장 연결 변경과
            전체 대사가 끝나야 새 지갑을 활성화한다.
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
