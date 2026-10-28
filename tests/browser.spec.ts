import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
const user = {
  id: "00000000-0000-0000-0000-000000000001",
  aud: "authenticated",
  role: "authenticated",
  email: "user@test.local",
  email_confirmed_at: "2026-01-01T00:00:00Z",
  app_metadata: { provider: "email", providers: ["email"] },
  user_metadata: {},
  identities: [],
  created_at: "2026-01-01T00:00:00Z",
};
const row = {
  id: "request-one",
  number: 1001,
  customer_id: "customer-one",
  title: "검증할 요청",
  description: "원래 요청 내용",
  requester_name: "담당자",
  requested_on: "2026-01-01",
  status: "received",
  requires_deployment: true,
  test_deployed_at: null,
  production_deployed_at: null,
  action_summary: "",
  created_by: user.id,
  updated_by: user.id,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  archived_at: null,
  version: 1,
};

// 외부 HTTP 경계만 대체한다. 실제 React 화면·Supabase SDK·앱 API를 실행한다.
async function mockLive(page: Page, admin = false) {
  const token =
    "eyJhbGciOiJIUzI1NiJ9." +
    Buffer.from(
      JSON.stringify({
        sub: user.id,
        role: "authenticated",
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
    ).toString("base64url") +
    ".test";
  await page.addInitScript(
    ({ user, token }) => {
      localStorage.setItem(
        "sb-test-project-auth-token",
        JSON.stringify({
          access_token: token,
          refresh_token: "test-refresh",
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          expires_in: 3600,
          token_type: "bearer",
          user,
        }),
      );
    },
    { user, token },
  );
  let activities: unknown[] = [];
  const attachments: Record<string, unknown>[] = [];
  const uploads = new Map<string, Buffer>();
  let failedOnce = false;
  await page.route("https://test-project.supabase.co/**", async (route) => {
    const req = route.request(),
      url = new URL(req.url());
    let result: unknown = [];
    if (url.pathname.startsWith("/storage/v1/object/")) {
      const path = decodeURIComponent(
        url.pathname.split("request-images/")[1] || "",
      );
      if (req.method() === "POST") {
        if (path.includes("file-2") && !failedOnce) {
          failedOnce = true;
          await route.fulfill({
            status: 503,
            json: { message: "일시적인 업로드 실패" },
          });
          return;
        }
        uploads.set(path, req.postDataBuffer()!);
        await route.fulfill({ json: { Key: path } });
        return;
      }
      if (req.method() === "GET") {
        const file = uploads.get(path);
        await route.fulfill(
          file
            ? { status: 200, contentType: "image/png", body: file }
            : { status: 404, json: { message: "파일 없음" } },
        );
        return;
      }
    }
    if (url.pathname === "/auth/v1/user") result = user;
    else if (url.pathname.endsWith("/profiles"))
      result = {
        ...user,
        display_name: "테스트 담당자",
        is_active: true,
        role: admin ? "admin" : "member",
      };
    else if (url.pathname.endsWith("/customers"))
      result = [
        {
          id: "customer-one",
          name: "가상 고객사",
          code: "TEST",
          is_active: true,
        },
      ];
    else if (url.pathname.endsWith("/get_people"))
      result = [{ id: user.id, display_name: "테스트 담당자" }];
    else if (url.pathname.endsWith("/requests")) result = row;
    else if (url.pathname.endsWith("/request_activities")) result = activities;
    else if (url.pathname.endsWith("/request_attachments"))
      result = attachments;
    else if (url.pathname.endsWith("/add_request_activity")) {
      const body = req.postDataJSON();
      activities = [
        {
          id: "act-one",
          request_id: row.id,
          kind: body.kind,
          body: body.body,
          created_by: user.id,
          created_at: "2026-01-02T00:00:00Z",
          metadata: {},
        },
      ];
      result = "act-one";
    } else if (url.pathname.endsWith("/reserve_attachment")) {
      const body = req.postDataJSON(),
        id = `file-${attachments.length + 1}`;
      result = {
        ...body,
        id,
        storage_path: `customer-one/request-one/${id}.png`,
        state: "pending",
        created_by: user.id,
        created_at: "2026-01-02T00:00:00Z",
      };
      attachments.push(result as Record<string, unknown>);
    } else if (url.pathname.endsWith("/finalize_attachment")) {
      const a = attachments.find((a) => a.id === req.postDataJSON().id);
      if (a) a.state = "ready";
      result = null;
    } else if (url.pathname.endsWith("/list_requests")) {
      const body = req.postDataJSON();
      const all = Array.from({ length: 120 }, (_, i) => ({
        ...row,
        id: `request-${i}`,
        number: 1001 + i,
        title: `검증 요청 ${i + 1}`,
      }));
      const matches =
        body.status_filter && body.status_filter !== "received" ? [] : all;
      result = {
        rows: matches.slice(
          body.offset_count,
          body.offset_count + Math.min(body.limit_count, 100),
        ),
        total: matches.length,
        counts: { received: 120 },
        pending: 0,
      };
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(result),
    });
  });
}
test("활동 추가가 저장하지 않은 요청 본문을 지우지 않는다", async ({
  page,
}) => {
  await mockLive(page);
  await page.goto("http://127.0.0.1:5175/#/requests/request-one");
  await page
    .getByRole("heading", { name: "검증할 요청", exact: true })
    .waitFor();
  const description = page.locator("textarea").first();
  await description.fill("아직 저장하지 않은 편집");
  await page.getByLabel("활동 내용").fill("메모만 추가");
  await page.getByRole("button", { name: "기록 추가", exact: true }).click();
  await expect(
    page.getByText("기록을 추가했습니다.", { exact: true }),
  ).toBeVisible();
  await expect(description).toHaveValue("아직 저장하지 않은 편집");
});
test("칸반 더 보기는 100건을 넘어 다음 페이지를 가져온다", async ({ page }) => {
  await mockLive(page);
  await page.goto("http://127.0.0.1:5175/#/board");
  await expect(page.locator(".request-card")).toHaveCount(30);
  for (const count of [60, 90, 120]) {
    await page.getByRole("button", { name: "더 보기", exact: true }).click();
    await expect(page.locator(".request-card")).toHaveCount(count);
  }
  await expect(
    page.getByRole("button", { name: "더 보기", exact: true }),
  ).toHaveCount(0);
});
test("첨부 부분 실패 후 성공 파일은 반복하지 않고 예약된 실패 파일만 다시 저장한다", async ({
  page,
}) => {
  await mockLive(page);
  await page.goto("http://127.0.0.1:5175/#/requests/request-one");
  await page
    .getByRole("heading", { name: "검증할 요청", exact: true })
    .waitFor();
  const png = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 10;
    c.height = 10;
    c.getContext("2d")!.fillRect(0, 0, 10, 10);
    return c.toDataURL("image/png").split(",")[1];
  });
  await page.locator(".image-picker input[type=file]").setInputFiles([
    {
      name: "a.png",
      mimeType: "image/png",
      buffer: Buffer.from(png, "base64"),
    },
    {
      name: "b.png",
      mimeType: "image/png",
      buffer: Buffer.from(png, "base64"),
    },
  ]);
  await expect(page.locator(".image-previews figure")).toHaveCount(2);
  await page
    .getByRole("button", { name: "선택 이미지 저장", exact: true })
    .click();
  await expect(page.locator(".attachment")).toHaveCount(2);
  await expect(page.getByRole("alert")).toBeVisible();
  await page
    .getByRole("button", { name: "선택 이미지 저장", exact: true })
    .click();
  await expect(
    page.getByText("이미지를 첨부했습니다.", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".attachment")).toHaveCount(2);
  await expect(page.locator(".attachment-placeholder")).toHaveCount(0);
  await expect(page.locator(".image-previews figure")).toHaveCount(0);
});
test("읽기 전용 데모의 보드·필터·상세·모바일", async ({ page }) => {
  await page.goto("http://127.0.0.1:5174/#/board");
  await expect(page.locator(".request-card")).toHaveCount(10);
  await page.getByRole("button", { name: /운영 반영 대기/ }).click();
  await expect(page.locator(".request-card")).toHaveCount(3);
  await expect(
    page.locator(".kanban-column").last().locator(".request-card"),
  ).toHaveCount(1);
  await page.getByRole("button", { name: /운영 반영 대기/ }).click();
  await expect(page.locator(".request-card")).toHaveCount(10);
  await page.getByLabel("고객사 필터").selectOption("saebom");
  await expect(page.locator(".request-card")).toHaveCount(5);
  await page.getByLabel("고객사 필터").selectOption("");
  await page.getByLabel("제목·내용 검색").fill("거래명세서");
  await expect(page.locator(".request-card")).toHaveCount(1);
  await page
    .getByRole("link", {
      name: "거래명세서 출력 시 합계 금액 수정",
      exact: true,
    })
    .click();
  await expect(page.locator("textarea").first()).toBeDisabled();
  await page.reload();
  await expect(
    page.getByRole("heading", {
      name: "거래명세서 출력 시 합계 금액 수정",
      exact: true,
    }),
  ).toBeVisible();
  await page.goto("http://127.0.0.1:5174/#/requests");
  await expect(page.locator("tbody tr")).toHaveCount(10);
  await page.goto("http://127.0.0.1:5174/#/admin/users");
  await expect(
    page.getByRole("heading", { name: "진행 현황", exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("모바일 메뉴와 필터 초기화, 상세에서 목록 복귀", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(
    "http://127.0.0.1:5174/#/requests?customer=hanbit&deployment=pending",
  );
  await expect(page.locator("tbody tr")).toHaveCount(2);
  await page
    .getByRole("link", {
      name: "거래명세서 출력 시 합계 금액 수정",
      exact: true,
    })
    .click();
  await page.getByRole("link", { name: "목록으로 돌아가기" }).click();
  await expect(page).toHaveURL(/requests\?customer=hanbit&deployment=pending/);
  await page.getByRole("button", { name: "필터 초기화" }).click();
  await expect(page.locator("tbody tr")).toHaveCount(10);
  await expect(
    page.getByRole("link", {
      name: "매출 조회 화면의 검색 조건 유지",
      exact: true,
    }),
  ).toBeInViewport();
  await page.getByText("메뉴", { exact: true }).click();
  await page
    .getByRole("navigation", { name: "모바일 메뉴" })
    .getByRole("link", { name: "진행 현황", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "진행 현황", exact: true }),
  ).toBeVisible();
});

test("모바일에서도 관리자 고객사 표의 헤더와 편집 동작을 유지한다", async ({
  page,
}) => {
  await mockLive(page, true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("http://127.0.0.1:5175/#/admin/customers");
  await expect(
    page.getByRole("columnheader", { name: "고객사", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "수정", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "고객사 수정" }),
  ).toBeVisible();
});
