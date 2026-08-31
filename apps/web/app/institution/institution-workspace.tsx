"use client";

import { useCallback, useEffect, useState } from "react";

import {
  allProducts,
  platformFetch,
  type Complaint,
  type Product,
  type PrimaryOrder,
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
  const [message, setMessage] = useState("기관 대기열을 불러오는 중이다.");

  const refresh = useCallback(async () => {
    try {
      const [productItems, complaintPage, taskPage, orderPage] = await Promise.all([
        allProducts(),
        platformFetch<{ items: Complaint[] }>("/complaints", { token: brokerToken }),
        platformFetch<{ items: Workflow[] }>("/institution/tasks", { token: brokerToken }),
        platformFetch<{ items: PrimaryOrder[] }>("/primary-orders", { token: brokerToken }),
      ]);
      setProducts(productItems);
      setComplaints(complaintPage.items);
      setTasks(taskPage.items);
      setPrimaryOrders(orderPage.items);
      setMessage("최신 모의 투영을 확인했다.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "조회에 실패했다.");
    }
  }, []);

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
                task.workflowType.startsWith("PRIMARY_") ? (
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
