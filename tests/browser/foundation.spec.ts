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

  await page.goto("/institution");
  await expect(page.getByRole("heading", { name: "통합 기관 콘솔" })).toBeVisible();
  await expect(
    page.getByText("역할 전환은 화면 범위만 바꾸며 실제 실행 권한을 부여하지 않는다."),
  ).toBeVisible();
});
