import { expect, test } from "@playwright/test";

test("실행 기반 화면은 모의 환경과 두 화면군을 분명히 표시한다", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: /한국형 규제 수탁 권리/ })).toBeVisible();
  await expect(page.getByText("모의 환경 · 실제 자산 없음")).toBeVisible();
  await expect(page.getByRole("link", { name: /투자자 앱/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /통합 기관 콘솔/ })).toBeVisible();
});

test("투자자와 기관 화면은 서로 다른 모의 업무공간으로 이동한다", async ({ page }) => {
  await page.goto("/investor");
  await expect(page.getByRole("heading", { name: "투자자 업무공간" })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("모의 환경");
  await expect(page.getByText("201개 등록")).toBeVisible();
  await expect(page.getByText("대표 시연").first()).toBeVisible();
  await expect(page.getByText("발행 · 24시간 거래 · 환매 모두 차단").first()).toBeVisible();

  await page.goto("/institution");
  await expect(page.getByRole("heading", { name: "통합 기관 콘솔" })).toBeVisible();
  await expect(page.getByText(/화면상 역할 전환은 실제 권한을 부여하지 않는다/)).toBeVisible();
  await expect(page.getByRole("status")).toContainText("모의 환경");
  await expect(page.getByText("공식 ISIN, 수탁 지원과 판매정책 확인 전")).toBeVisible();
});

test("거절·만료 고객은 주문 차단 상태와 이유를 확인한다", async ({ page }) => {
  await page.goto("/investor");
  await page.getByLabel("합성 고객").selectOption("denied");
  await expect(page.getByText("INELIGIBLE", { exact: true })).toBeVisible();
  await expect(page.getByText("유효한 판매 가능 판정이 없다.")).toBeVisible();
  await page.getByLabel("합성 고객").selectOption("expired");
  await expect(page.getByText("EXPIRED", { exact: true }).first()).toBeVisible();
});

test("위험공시, 전용 지갑과 민원을 비동기로 접수하고 종결한다", async ({ page }) => {
  await page.goto("/investor");
  await page.getByRole("button", { name: "위 내용을 확인하고 전자 동의" }).click();
  await expect(page.getByRole("status")).toContainText("위험공시 동의를 접수했다");
  await page.getByRole("button", { name: "시험 전용 지갑 연결 요청" }).click();
  await expect(page.getByRole("status")).toContainText("기관 승인과 체인 반영 전");

  const title = `모의 민원 ${Date.now()}`;
  await page.getByLabel("제목").fill(title);
  await page.getByRole("button", { name: "민원 접수" }).click();
  await expect(page.getByRole("status")).toContainText("민원을 접수했다");

  const investorComplaint = page.getByText(title).locator("..");
  await expect
    .poll(async () => {
      await page.getByRole("button", { name: "새로고침" }).click();
      return investorComplaint.textContent();
    })
    .toContain("SUBMITTED");

  await page.goto("/institution");
  await expect(page.getByRole("table", { name: "지갑 승인 대기열" })).toBeVisible();
  await expect(page.getByRole("table", { name: "민원 처리 대기열" })).toBeVisible();
  const complaintRow = page.getByRole("row").filter({ hasText: title });
  const expectedStatuses = [
    "ASSIGNED",
    "IN_PROGRESS",
    "RESPONSE_RECORDED",
    "CORRECTION_REVIEW",
    "CLOSED",
  ];
  for (const status of expectedStatuses) {
    await complaintRow.getByRole("button", { name: "다음 단계 접수" }).click();
    await expect
      .poll(async () => {
        await page.getByRole("button", { name: "새로고침" }).click();
        return complaintRow.textContent();
      })
      .toContain(status);
  }

  await page.goto("/investor");
  await page.getByRole("button", { name: "새로고침" }).click();
  await expect(page.getByText(title).locator("..")).toContainText("CLOSED");
});
