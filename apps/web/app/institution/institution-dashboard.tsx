"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import {
  platformFetch,
  type Activity,
  type MarketMakerHedge,
  type MarketMakerPosition,
  type OperationalHold,
  type Position,
  type Workflow,
  type WorkflowTimeline,
} from "../lib/platform-api";

export type InstitutionWorkspaceKey =
  "dashboard" | "broker" | "domestic" | "custody" | "market-maker" | "audit";

const workspaces: Array<[InstitutionWorkspaceKey, string, string]> = [
  ["dashboard", "업무 대시보드", "/institution"],
  ["broker", "인가 해외 증권사", "/institution/broker"],
  ["domestic", "국내 주문·결제", "/institution/domestic"],
  ["custody", "수탁·권리", "/institution/custody"],
  ["market-maker", "시장조성", "/institution/market-maker"],
  ["audit", "준법·감사", "/institution/audit"],
];

const brokerToken = "demo:broker-operator";

function label(workspace: InstitutionWorkspaceKey) {
  return workspaces.find(([key]) => key === workspace)?.[1] ?? "업무 대시보드";
}

export function InstitutionDashboard({ workspace }: { workspace: InstitutionWorkspaceKey }) {
  const [tasks, setTasks] = useState<Workflow[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [mmPositions, setMmPositions] = useState<MarketMakerPosition[]>([]);
  const [hedges, setHedges] = useState<MarketMakerHedge[]>([]);
  const [holds, setHolds] = useState<OperationalHold[]>([]);
  const [message, setMessage] = useState("기관 업무를 불러오는 중이다.");

  const refresh = useCallback(async () => {
    try {
      const [taskPage, activityPage, positionPage, mmPage, hedgePage, holdPage] = await Promise.all(
        [
          platformFetch<{ items: Workflow[] }>("/institution/tasks", { token: brokerToken }),
          platformFetch<{ items: Activity[] }>("/activities?limit=100", { token: brokerToken }),
          platformFetch<{ items: Position[] }>("/positions?limit=100", { token: brokerToken }),
          platformFetch<{ items: MarketMakerPosition[] }>("/market-maker/positions", {
            token: brokerToken,
          }),
          platformFetch<{ items: MarketMakerHedge[] }>("/market-maker/hedges", {
            token: brokerToken,
          }),
          platformFetch<{ items: OperationalHold[] }>("/holds", { token: brokerToken }),
        ],
      );
      setTasks(taskPage.items);
      setActivities(activityPage.items);
      setPositions(positionPage.items);
      setMmPositions(mmPage.items);
      setHedges(hedgePage.items);
      setHolds(holdPage.items);
      setMessage("같은 기준시각의 권리·토큰·자금·국내 수량 투영을 확인했다.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "기관 업무 조회에 실패했다.");
    }
  }, []);

  useEffect(() => void refresh(), [refresh]);

  const workflowActivities = Array.from(
    new Map(activities.map((item) => [item.workflowId, item])).values(),
  );
  const mainPosition = positions.find((item) => item.securityId === "990001");

  return (
    <main className="institutionAppShell">
      <header className="institutionTopbar">
        <Link href="/">K-EQUITY CONTROL</Link>
        <strong>통합 기관 콘솔</strong>
        <span className="simulationBadge">모의 환경</span>
      </header>
      <div className="institutionLayout">
        <aside className="institutionSidebar">
          <p>업무공간</p>
          {workspaces.map(([key, name, path]) => (
            <Link key={key} aria-current={workspace === key ? "page" : undefined} href={path}>
              {name}
            </Link>
          ))}
          <Link className="advancedOperations" href="/institution/operations">
            상세 승인·시험 제어
          </Link>
        </aside>
        <section className="institutionMain">
          <div className="institutionHeading">
            <div>
              <p className="eyebrow">INSTITUTION WORKSPACE</p>
              <h1>{label(workspace)}</h1>
              <p>
                화면 전환은 시연 편의 기능이며 실제 권한 변경이 아니다. 각 역할은 자신의 승인 업무만
                수행한다.
              </p>
            </div>
            <button type="button" onClick={() => void refresh()}>
              새로고침
            </button>
          </div>
          <div className="institutionNotice">{message}</div>
          {workspace === "dashboard" ? (
            <DashboardSummary tasks={tasks} activities={workflowActivities} holds={holds} />
          ) : null}
          {workspace === "broker" ? (
            <BrokerWorkspace tasks={tasks} activities={workflowActivities} />
          ) : null}
          {workspace === "domestic" ? (
            <DomesticWorkspace tasks={tasks} activities={workflowActivities} />
          ) : null}
          {workspace === "custody" ? (
            <CustodyWorkspace position={mainPosition} tasks={tasks} />
          ) : null}
          {workspace === "market-maker" ? (
            <MarketMakerWorkspace positions={mmPositions} hedges={hedges} />
          ) : null}
          {workspace === "audit" ? (
            <AuditWorkspace position={mainPosition} holds={holds} activities={workflowActivities} />
          ) : null}
        </section>
      </div>
    </main>
  );
}

function WorkflowRows({
  items,
}: {
  items: Array<{
    workflowId: string;
    workflowType?: string;
    labelKo?: string;
    occurredAt?: string;
  }>;
}) {
  return (
    <div className="institutionWorkflowList">
      {items.length ? (
        items.slice(0, 12).map((item) => (
          <article key={item.workflowId}>
            <div>
              <strong>{item.labelKo ?? item.workflowType ?? "기관 업무"}</strong>
              <code>{item.workflowId}</code>
            </div>
            <Link href={`/institution/workflows/${item.workflowId}`}>업무 거래실 열기</Link>
          </article>
        ))
      ) : (
        <p className="emptyState">현재 표시할 업무가 없다.</p>
      )}
    </div>
  );
}

function DashboardSummary({
  tasks,
  activities,
  holds,
}: {
  tasks: Workflow[];
  activities: Activity[];
  holds: OperationalHold[];
}) {
  return (
    <>
      <div className="institutionMetrics">
        <div>
          <span>승인 대기</span>
          <strong>{tasks.length}</strong>
        </div>
        <div>
          <span>진행 업무</span>
          <strong>{activities.length}</strong>
        </div>
        <div>
          <span>중지·격리</span>
          <strong>{holds.length}</strong>
        </div>
        <div>
          <span>메인 상품</span>
          <strong>990001</strong>
        </div>
      </div>
      <section className="institutionPanel">
        <div className="institutionPanelHeading">
          <div>
            <h2>최근 업무</h2>
            <p>투자자 화면과 동일한 업무 ID를 사용한다.</p>
          </div>
        </div>
        <WorkflowRows items={activities} />
      </section>
    </>
  );
}

function BrokerWorkspace({ tasks, activities }: { tasks: Workflow[]; activities: Activity[] }) {
  return (
    <>
      <section className="responsibilityStrip">
        <strong>기준 기록</strong>
        <span>고객계약 · 고객자금 · 고객별 수탁권리 원장 · T+2 위험 승인</span>
      </section>
      <section className="institutionPanel">
        <h2>내 승인 업무</h2>
        <p>
          체결·배분 확인과 구분된 위험 승인, 권리기입 승인, 실제 원장 반영 확인을 시간순으로
          처리한다.
        </p>
        <WorkflowRows items={tasks.length ? tasks : activities} />
        <Link
          className="primaryLink institutionActionLink"
          href="/institution/operations#institution-primary"
        >
          역할별 승인 화면 열기
        </Link>
      </section>
    </>
  );
}

function DomesticWorkspace({ tasks, activities }: { tasks: Workflow[]; activities: Activity[] }) {
  return (
    <>
      <section className="responsibilityStrip">
        <strong>기관 업무</strong>
        <span>취합주문 · 모의 KRX 체결·정정 · 국내 T+2 결제 확인</span>
      </section>
      <section className="institutionPanel">
        <h2>국내 주문과 결제 인계</h2>
        <p>투자자 주문을 직접 받지 않고 인가 해외 증권사의 취합주문과 모의 기관 응답을 처리한다.</p>
        <WorkflowRows items={tasks.length ? tasks : activities} />
        <Link
          className="primaryLink institutionActionLink"
          href="/institution/operations#institution-primary"
        >
          국내 처리 화면 열기
        </Link>
      </section>
    </>
  );
}

function CustodyWorkspace({
  position,
  tasks,
}: {
  position: Position | undefined;
  tasks: Workflow[];
}) {
  return (
    <>
      <section className="responsibilityStrip">
        <strong>기준 기록</strong>
        <span>국내 통합 보유총량 · 수탁수량 확인 · 배당·의결권·기업행동 증거</span>
      </section>
      <div className="institutionMetrics">
        <div>
          <span>결제완료 수탁권리</span>
          <strong>{position?.settledRights ?? "0"}</strong>
        </div>
        <div>
          <span>국내 결제 대기</span>
          <strong>{position?.pendingRights ?? "0"}</strong>
        </div>
        <div>
          <span>잠금</span>
          <strong>{position?.lockedRights ?? "0"}</strong>
        </div>
        <div>
          <span>소각 대기</span>
          <strong>{position?.burnPendingTokens ?? "0"}</strong>
        </div>
      </div>
      <section className="institutionPanel">
        <h2>수탁·권리 확인</h2>
        <WorkflowRows items={tasks} />
        <Link
          className="primaryLink institutionActionLink"
          href="/institution/operations#institution-rights"
        >
          권리업무 화면 열기
        </Link>
      </section>
    </>
  );
}

function MarketMakerWorkspace({
  positions,
  hedges,
}: {
  positions: MarketMakerPosition[];
  hedges: MarketMakerHedge[];
}) {
  const position = positions.find((item) => item.securityId === "990001");
  return (
    <>
      <section className="responsibilityStrip">
        <strong>지정 MM</strong>
        <span>결제완료 재고 안의 지정가 호가 · 순포지션 · 다음 KRX 개장 헤지</span>
      </section>
      <div className="institutionMetrics">
        <div>
          <span>결제완료 재고</span>
          <strong>{position?.settledInventory ?? "100"}</strong>
        </div>
        <div>
          <span>결제 대기 재고</span>
          <strong>{position?.pendingInventory ?? "20"}</strong>
        </div>
        <div>
          <span>순포지션</span>
          <strong>{position?.netPosition ?? "0"}</strong>
        </div>
        <div>
          <span>한도</span>
          <strong>±{position?.positionLimit ?? "20"}</strong>
        </div>
      </div>
      <section className="institutionPanel">
        <h2>헤지 대기열</h2>
        <WorkflowRows
          items={hedges.map((item) => ({
            workflowId: item.hedgeId,
            workflowType: `${item.direction} ${item.requestedQuantity}주 · ${item.status}`,
          }))}
        />
        <Link
          className="primaryLink institutionActionLink"
          href="/institution/operations#institution-hedge"
        >
          호가·헤지 제어 열기
        </Link>
      </section>
    </>
  );
}

function AuditWorkspace({
  position,
  holds,
  activities,
}: {
  position: Position | undefined;
  holds: OperationalHold[];
  activities: Activity[];
}) {
  return (
    <>
      <section className="responsibilityStrip">
        <strong>두 축 대사</strong>
        <span>고객별 수탁권리 합계 ↔ 발행토큰 · 국내 결제완료 수탁수량 ↔ 결제완료 고객 권리</span>
      </section>
      <section className="institutionPanel reconciliationPanel">
        <h2>같은 기준시각 비교</h2>
        <div>
          <span>고객별 수탁권리</span>
          <strong>
            {position
              ? BigInt(position.settledRights) +
                BigInt(position.pendingRights) +
                BigInt(position.lockedRights)
              : 0n}
          </strong>
        </div>
        <div>
          <span>소각 대기 제외 토큰</span>
          <strong>업무 거래실에서 체인 조회</strong>
        </div>
        <div>
          <span>중지·격리</span>
          <strong>{holds.length}건</strong>
        </div>
      </section>
      <section className="institutionPanel">
        <h2>감사 가능한 업무</h2>
        <WorkflowRows items={activities} />
        <Link
          className="primaryLink institutionActionLink"
          href="/institution/operations#institution-audit"
        >
          대사·재개 제어 열기
        </Link>
      </section>
    </>
  );
}

export function InstitutionWorkflowRoom({ workflowId }: { workflowId: string }) {
  const [timeline, setTimeline] = useState<WorkflowTimeline>();
  const [position, setPosition] = useState<Position>();
  const [message, setMessage] = useState("업무 증거를 불러오는 중이다.");
  useEffect(() => {
    void Promise.all([
      platformFetch<WorkflowTimeline>(`/workflows/${workflowId}/timeline`, { token: brokerToken }),
      platformFetch<{ items: Position[] }>("/positions?limit=100", { token: brokerToken }),
    ])
      .then(([nextTimeline, positions]) => {
        setTimeline(nextTimeline);
        setPosition(positions.items.find((item) => item.securityId === "990001"));
        setMessage("투자자 화면과 동일한 업무 ID의 증거를 확인했다.");
      })
      .catch((error: unknown) =>
        setMessage(error instanceof Error ? error.message : "업무 조회에 실패했다."),
      );
  }, [workflowId]);
  const lanes = [
    "투자자",
    "토큰 플랫폼",
    "인가 해외 증권사",
    "국내 주문집행 증권사",
    "수탁은행·상임대리인",
    "제한형 토큰 실행",
    "지정 시장조성자",
  ];
  return (
    <main className="institutionAppShell">
      <header className="institutionTopbar">
        <Link href="/institution">← 업무 대시보드</Link>
        <strong>업무 거래실</strong>
        <span className="simulationBadge">모의 환경</span>
      </header>
      <section className="transactionRoom">
        <div className="transactionRoomHeading">
          <div>
            <p className="eyebrow">WORKFLOW TRANSACTION ROOM</p>
            <h1>동일 업무의 기관 처리</h1>
            <code>{workflowId}</code>
            <p>{message}</p>
          </div>
          <Link className="subtleLink" href={`/investor/orders/${workflowId}?profile=investorA`}>
            투자자 주문 상세
          </Link>
        </div>
        <div className="transactionLedgerGrid">
          <div>
            <span>국내 통합 보유총량</span>
            <strong>2차거래 중 불변</strong>
            <small>국내 법적 장부·KSD 모의 확인</small>
          </div>
          <div>
            <span>고객별 수탁권리</span>
            <strong>{position?.settledRights ?? "0"}단위</strong>
            <small>인가 해외 증권사의 기준 기록</small>
          </div>
          <div>
            <span>제한형 토큰</span>
            <strong>체인 영수증 대사</strong>
            <small>권리 기준장부가 아님</small>
          </div>
          <div>
            <span>자금</span>
            <strong>USD 장부 / USDC</strong>
            <small>경로별 예약·확정</small>
          </div>
        </div>
        <section className="transactionLanes">
          {lanes.map((lane) => {
            const items =
              timeline?.items.filter((item) =>
                item.actorRoleKo.includes(lane.split("·")[0] ?? lane),
              ) ?? [];
            return (
              <article key={lane}>
                <h2>{lane}</h2>
                {items.length ? (
                  items.map((item) => (
                    <div className="transactionEvent" key={item.eventId}>
                      <div>
                        <strong>{item.labelKo}</strong>
                        <span>{item.category}</span>
                      </div>
                      <p>{item.recordLayerKo}</p>
                      <small>
                        {new Date(item.occurredAt).toLocaleString("ko-KR")} · {item.nextActionKo}
                      </small>
                      {item.transactionHash ? <code>{item.transactionHash}</code> : null}
                    </div>
                  ))
                ) : (
                  <p className="emptyState">아직 이 역할의 확인 기록이 없다.</p>
                )}
              </article>
            );
          })}
        </section>
        <aside className="transactionBoundary">
          <strong>완료 판정 경계</strong>
          <p>
            체인 거래가 성공해도 해외 증권사의 고객별 수탁권리 원장과 자금 결과가 확인되지 않으면
            완료로 표시하지 않는다. 일부만 끝나면 업무 단위로 격리하고 원기록을 유지한다.
          </p>
          <Link className="primaryLink" href="/institution/operations">
            역할별 승인·예외 처리 열기
          </Link>
        </aside>
      </section>
    </main>
  );
}
