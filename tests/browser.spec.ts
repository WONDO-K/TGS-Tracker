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
        const payload = req.postDataBuffer()!;
        const contentType = req.headers()["content-type"] || "";
        if (contentType.startsWith("multipart/form-data")) {
          const form = await new Response(new Uint8Array(payload), {
            headers: { "content-type": contentType },
          }).formData();
          const file = [...form.values()].find(
            (value) => typeof value !== "string",
          ) as File;
          uploads.set(path, Buffer.from(await file.arrayBuffer()));
        } else uploads.set(path, payload);
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
    else if (url.pathname.endsWith("/profiles")) {
      const profile = {
        ...user,
        display_name: "테스트 담당자",
        is_active: true,
        role: admin ? "admin" : "member",
      };
      result = url.searchParams.has("id")
        ? profile
        : [
            profile,
            {
              ...profile,
              id: "colleague",
              email: "colleague@test.local",
              display_name: "동료",
              role: "member",
            },
          ];
    } else if (url.pathname.endsWith("/customers"))
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
  await page.getByRole("button", { name: "요청 수정", exact: true }).click();
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
  await page.getByRole("button", { name: "a.png 확대", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "a.png 이미지 뷰어" }),
  ).toBeVisible();
  await expect
    .poll(
      async () =>
        (await page.locator(".image-dialog[open] img").boundingBox())?.height ||
        0,
    )
    .toBeGreaterThan(140);
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("dialog", { name: "a.png 이미지 뷰어" }),
  ).not.toBeVisible();
});

test("시안의 모바일 상태 탭은 선택한 단계만 보여준다", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("http://127.0.0.1:5174/#/board");
  await expect(
    page.getByRole("tab", { name: "접수 2", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".request-card:visible")).toHaveCount(2);
  await expect(
    page.getByRole("tab", { name: "완료 4", exact: true }),
  ).toBeInViewport();
  await page.getByRole("tab", { name: "접수 2", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("tab", { name: "진행 중 2", exact: true }),
  ).toBeFocused();
  await page.getByRole("tab", { name: "완료 4", exact: true }).click();
  await expect(page.locator(".request-card:visible")).toHaveCount(4);
  await page.getByRole("button", { name: /테스트 반영 · 운영 미반영/ }).click();
  await page.getByRole("tab", { name: "완료 1", exact: true }).click();
  await expect(page.locator(".request-card:visible")).toHaveCount(1);
});

test("반영일 초기화는 확인 모달에서 취소할 수 있다", async ({ page }) => {
  await mockLive(page);
  await page.goto("http://127.0.0.1:5175/#/requests/request-one");
  await page.getByRole("button", { name: "요청 수정", exact: true }).click();
  await page.getByLabel("테스트 반영일 (한국 시간)").fill("2026-01-01T10:00");
  await page.getByLabel("서버 배포 필요", { exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "배포 불필요로 변경할까요?",
  });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "취소", exact: true }).click();
  await expect(
    page.getByLabel("서버 배포 필요", { exact: true }),
  ).toBeChecked();
  await expect(page.getByLabel("테스트 반영일 (한국 시간)")).toHaveValue(
    "2026-01-01T10:00",
  );
});

test("관리자 승격은 전체 고객사 접근 동의 후에만 실행한다", async ({
  page,
}) => {
  await mockLive(page, true);
  await page.goto("http://127.0.0.1:5175/#/admin/users");
  await page.getByRole("button", { name: "동료 관리", exact: true }).click();
  const colleague = page.locator(".user-panel");
  await colleague
    .getByRole("combobox", { name: "역할", exact: true })
    .selectOption("admin");
  await colleague.getByRole("button", { name: "설정 저장" }).click();
  const dialog = page.getByRole("dialog", { name: "동료 관리자 승격" });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "관리자로 변경" }),
  ).toBeDisabled();
  await dialog.getByRole("checkbox").check();
  await expect(
    dialog.getByRole("button", { name: "관리자로 변경" }),
  ).toBeEnabled();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
});
test("읽기 전용 데모의 보드·필터·상세·모바일", async ({ page }) => {
  await page.goto("http://127.0.0.1:5174/#/board");
  await expect(page.locator(".request-card")).toHaveCount(10);
  await page.locator(".release-review").click();
  await expect(page.locator(".request-card")).toHaveCount(3);
  await expect(
    page.locator(".kanban-column").last().locator(".request-card"),
  ).toHaveCount(1);
  await page.locator(".release-review").click();
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
  await expect(
    page.getByRole("button", { name: "요청 수정", exact: true }),
  ).toHaveCount(0);
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
  await page.setViewportSize({ width: 900, height: 1024 });
  await page.getByText("메뉴", { exact: true }).click();
  const menu = page.getByRole("navigation", { name: "모바일 메뉴" });
  await expect(menu).toBeVisible();
  const menuBox = await menu.boundingBox(),
    barBox = await page.locator(".bottom-nav").boundingBox();
  expect(menuBox!.y + menuBox!.height).toBeLessThan(barBox!.y);
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
  await page
    .getByRole("button", { name: "가상 고객사 수정", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "고객사 수정" }),
  ).toBeVisible();
});

test("저장 충돌에서 입력 복사와 최신 내용 취소로 초안을 보존한다", async ({
  page,
}) => {
  await mockLive(page);
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: async (text: string) => {
          Object.assign(window, { copiedDraft: text });
        },
      },
    }),
  );
  await page.route("**/rest/v1/rpc/update_request", (r) =>
    r.fulfill({
      status: 409,
      json: {
        message: "다른 사용자가 먼저 수정했습니다. 최신 내용을 확인해주세요.",
      },
    }),
  );
  await page.goto("http://127.0.0.1:5175/#/requests/request-one");
  await page.getByRole("button", { name: "요청 수정", exact: true }).click();
  await page
    .getByRole("textbox", { name: "요청 내용", exact: true })
    .fill("복원할 미저장 내용");
  await page
    .getByRole("button", { name: "변경사항 저장", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("다른 사용자가");
  await page.getByRole("button", { name: "내 입력 복사", exact: true }).click();
  expect(
    await page.evaluate(() => Reflect.get(window, "copiedDraft")),
  ).toContain("복원할 미저장 내용");
  await page
    .getByRole("button", { name: "최신 내용 불러오기", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "취소", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "요청 내용", exact: true }),
  ).toHaveValue("복원할 미저장 내용");
});

test("운영 반영 저장은 확인 후 실행하며 취소하면 날짜를 보존한다", async ({
  page,
}) => {
  await mockLive(page);
  let writes = 0;
  await page.route("**/rest/v1/rpc/update_request", (r) => {
    writes++;
    return r.fulfill({ json: row });
  });
  await page.goto("http://127.0.0.1:5175/#/requests/request-one");
  await page.getByRole("button", { name: "요청 수정", exact: true }).click();
  await page.getByLabel("운영 반영일 (한국 시간)").fill("2026-01-01T15:00");
  await page
    .getByRole("button", { name: "변경사항 저장", exact: true })
    .click();
  const modal = page.getByRole("dialog", { name: "운영 반영 기록 확인" });
  await expect(modal).toBeVisible();
  expect(writes).toBe(0);
  await modal.getByRole("button", { name: "취소", exact: true }).click();
  await expect(page.getByLabel("운영 반영일 (한국 시간)")).toHaveValue(
    "2026-01-01T15:00",
  );
  await page
    .getByRole("button", { name: "변경사항 저장", exact: true })
    .click();
  await modal
    .getByRole("button", { name: "변경사항 저장", exact: true })
    .click();
  await expect.poll(() => writes).toBe(1);
});

for (const fails of [false, true])
  test(`칸반 실제 포인터 드래그 ${fails ? "실패 시 기존 상태 유지" : "성공 시 DB 응답 후 상태 갱신"}`, async ({
    page,
  }) => {
    await mockLive(page);
    let current = { ...row },
      writes = 0;
    await page.route("**/rest/v1/rpc/list_requests", async (r) => {
      const body = r.request().postDataJSON();
      const rows =
        !body.status_filter || body.status_filter === current.status
          ? [current]
          : [];
      await r.fulfill({
        json: {
          rows,
          total: rows.length,
          counts: { [current.status]: 1 },
          pending: 0,
        },
      });
    });
    await page.route("**/rest/v1/rpc/update_request", async (r) => {
      writes++;
      const body = r.request().postDataJSON();
      expect(body.expected_version).toBe(1);
      expect(body.patch).toEqual({ status: "in_progress" });
      if (fails)
        await r.fulfill({
          status: 409,
          json: { message: "다른 사용자가 먼저 수정했습니다." },
        });
      else {
        current = { ...current, status: body.patch.status, version: 2 };
        await r.fulfill({ json: current });
      }
    });
    await page.goto("http://127.0.0.1:5175/#/board");
    const handle = page.locator("#lane-received .request-card .card-meta");
    await expect(handle).toBeVisible();
    const from = await handle.boundingBox(),
      to = await page.locator("#lane-in_progress").boundingBox();
    expect(to!.height).toBeGreaterThanOrEqual(360);
    await page.mouse.move(
      from!.x + from!.width / 2,
      from!.y + from!.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      from!.x + from!.width / 2 + 12,
      from!.y + from!.height / 2,
      { steps: 3 },
    );
    await page.mouse.move(to!.x + to!.width / 2, to!.y + 30, { steps: 15 });
    await expect(page.locator(".card-drag-preview")).toBeVisible();
    await expect(
      page.locator("#lane-in_progress .drop-placeholder"),
    ).toBeVisible();
    await page.mouse.up();
    await expect.poll(() => writes).toBe(1);
    await expect(page).toHaveURL(/#\/board$/);
    if (fails) {
      await expect(page.getByRole("alert")).toContainText("다른 사용자가");
      await expect(page.locator("#lane-received .request-card")).toHaveCount(1);
    } else {
      await expect(page.locator("#lane-in_progress .request-card")).toHaveCount(
        1,
      );
      await expect(page.locator(".alert[role=status]")).toContainText(
        "진행 중 상태로 변경",
      );
    }
  });

for (const refreshFails of [false, true])
  test(`상태 저장 후 백그라운드 재조회 ${refreshFails ? "실패를 구분한다" : "동안 보드를 유지한다"}`, async ({
    page,
  }) => {
    await mockLive(page);
    let saved = false,
      reads = 0;
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/rest/v1/rpc/update_request", async (route) => {
      saved = true;
      await route.fulfill({ json: null });
    });
    await page.route("**/rest/v1/rpc/list_requests", async (route) => {
      const status = saved ? "in_progress" : "received";
      if (saved) {
        reads++;
        await pending;
      }
      if (saved && refreshFails) {
        await route.fulfill({
          status: 500,
          json: { message: "재조회 연결 실패" },
        });
        return;
      }
      const rows =
        route.request().postDataJSON().status_filter === status
          ? [{ ...row, status, version: saved ? 2 : 1 }]
          : [];
      await route.fulfill({
        json: { rows, total: rows.length, counts: { [status]: 1 }, pending: 0 },
      });
    });
    await page.goto("http://127.0.0.1:5175/#/board");
    const card = await page.locator(".request-card").elementHandle();
    await page.locator(".card-status").selectOption("in_progress");
    await expect.poll(() => reads).toBe(4);
    try {
      await expect(page.locator(".kanban")).toBeVisible();
      expect(await card!.evaluate((node) => node.isConnected)).toBe(true);
      await expect(page.locator(".card-status")).toBeDisabled();
    } finally {
      release();
    }
    if (refreshFails) {
      await expect(page.getByRole("alert")).toContainText("재조회 연결 실패");
      await expect(page.locator(".alert[role=status]")).toContainText(
        "저장했지만",
      );
      await expect(page.locator("#lane-received .request-card")).toHaveCount(1);
    } else {
      await expect(page.locator("#lane-in_progress .request-card")).toHaveCount(
        1,
      );
      await expect(page.locator("#lane-in_progress header b")).toHaveText("1");
      await expect(page.locator("#lane-received header b")).toHaveText("0");
    }
    await expect(page.locator(".card-status")).toBeEnabled();
  });

test("초대 만료는 인증 폼 대신 복구 안내를 제공하고 URL에서 오류를 정리한다", async ({
  page,
}) => {
  await page.goto(
    "http://127.0.0.1:5175/?error=access_denied&error_description=expired#/login",
  );
  await expect(
    page.getByRole("heading", { name: "인증 링크를 사용할 수 없습니다" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "로그인", exact: true }),
  ).toHaveCount(0);
  expect(page.url()).not.toContain("error_description");
  await page
    .getByRole("link", { name: "비밀번호 재설정", exact: true })
    .click();
  await page
    .getByRole("link", { name: "로그인으로 돌아가기", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "로그인", exact: true }),
  ).toBeVisible();
});

test("비밀번호 재설정 완료와 설정 검증을 안내한다", async ({ page }) => {
  await page.route("**/auth/v1/recover*", (r) => r.fulfill({ json: {} }));
  await page.goto("http://127.0.0.1:5175/#/reset-password");
  await page.getByLabel("이메일", { exact: true }).fill("test@example.com");
  await page
    .getByRole("button", { name: /재설정.*발송|재설정.*보내기/ })
    .click();
  await expect(page.locator(".alert[role=status]")).toContainText(
    "등록된 계정이라면",
  );
  await page.goto("http://127.0.0.1:5175/#/set-password");
  await page.getByLabel("새 비밀번호", { exact: true }).fill("short");
  await page
    .getByRole("button", { name: /비밀번호.*저장|비밀번호.*설정/ })
    .click();
  await expect(
    page.getByText("비밀번호를 10자 이상 입력해 주세요.", { exact: true }),
  ).toBeVisible();
});

test("존재하지 않는 화면은 404와 복귀 링크를 표시한다", async ({ page }) => {
  await page.goto("http://127.0.0.1:5174/#/missing-page");
  await expect(
    page.getByRole("heading", { name: "페이지를 찾을 수 없습니다" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "진행 현황으로 이동", exact: true }),
  ).toBeVisible();
});

test("초대 실패 초안 유지와 마지막 관리자 보호", async ({ page }) => {
  await mockLive(page, true);
  let sends = 0;
  await page.route("**/functions/v1/invite-user", (r) => {
    sends++;
    return r.fulfill({
      status: 503,
      json: { error: "메일 서버에 연결하지 못했습니다." },
    });
  });
  await page.goto("http://127.0.0.1:5175/#/admin/users");
  await page
    .locator(".user-panel")
    .getByRole("combobox", { name: "역할", exact: true })
    .selectOption("member");
  await page.getByRole("button", { name: "설정 저장", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("마지막 활성 관리자");
  await page
    .getByRole("button", { name: "+ 사용자 초대", exact: true })
    .click();
  const modal = page.getByRole("dialog", { name: "동료를 초대합니다" });
  await modal.getByLabel("이름", { exact: true }).fill("새 동료");
  await modal.getByRole("textbox", { name: /이메일/ }).fill("new@example.com");
  await modal
    .getByRole("button", { name: "초대 메일 보내기", exact: true })
    .click();
  await expect(modal.getByRole("alert")).toContainText("메일 서버");
  await expect(modal.getByLabel("이름", { exact: true })).toHaveValue(
    "새 동료",
  );
  expect(sends).toBe(1);
});

test("권한 부분 저장 후 되돌려 재시도하면 최종 권한도 되돌린다", async ({
  page,
}) => {
  await mockLive(page, true);
  const roles: string[] = [];
  let assignments = 0;
  await page.route("**/rest/v1/rpc/set_user_access", (r) => {
    roles.push(r.request().postDataJSON().role);
    return r.fulfill({ json: null });
  });
  await page.route("**/rest/v1/rpc/set_customer_members", (r) => {
    assignments++;
    return r.fulfill(
      assignments === 1
        ? { status: 503, json: { message: "배정 저장 실패" } }
        : { json: null },
    );
  });
  await page.goto("http://127.0.0.1:5175/#/admin/users");
  await page.getByRole("button", { name: "동료 관리", exact: true }).click();
  const editor = page.locator(".user-panel");
  await editor
    .getByRole("combobox", { name: "역할", exact: true })
    .selectOption("admin");
  await editor.getByRole("button", { name: "설정 저장", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "동료 관리자 승격" });
  await dialog.getByRole("checkbox").check();
  await dialog
    .getByRole("button", { name: "관리자로 변경", exact: true })
    .click();
  await expect(editor.getByRole("alert")).toContainText(
    "배정을 완료하지 못했습니다",
  );
  await editor
    .getByRole("combobox", { name: "역할", exact: true })
    .selectOption("member");
  await editor.getByRole("button", { name: "설정 저장", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("사용자 설정을 저장");
  expect(roles).toEqual(["admin", "member"]);
});

test("보관과 복원은 확인 후 실행하며 보관 중에는 편집을 막는다", async ({
  page,
}) => {
  await mockLive(page, true);
  let current: { archived_at: string | null; version: number } = {
    archived_at: null,
    version: 1,
  };
  await page.route("**/rest/v1/requests?*", (r) =>
    r.fulfill({ json: { ...row, ...current } }),
  );
  await page.route("**/rest/v1/rpc/set_request_archived", (r) => {
    const data = r.request().postDataJSON();
    expect(data.expected_version).toBe(current.version);
    current = {
      archived_at: data.archived ? "2026-01-02T00:00:00Z" : null,
      version: current.version + 1,
    };
    return r.fulfill({ json: null });
  });
  await page.goto("http://127.0.0.1:5175/#/requests/request-one");
  await page.getByRole("button", { name: "요청 보관", exact: true }).click();
  await page
    .getByRole("dialog", { name: "요청 보관" })
    .getByRole("button", { name: "보관", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "요청 수정", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "요청 복원", exact: true }).click();
  await page
    .getByRole("dialog", { name: "요청 복원" })
    .getByRole("button", { name: "복원", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "요청 수정", exact: true }),
  ).toBeEnabled();
});

test("공개 데모 인증 화면에는 로그인·비밀번호 변경 폼을 노출하지 않는다", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5174/#/login");
  await expect(page.getByText(/읽기 전용 데모에서는 계정/)).toBeVisible();
  await expect(page.locator("form")).toHaveCount(0);
});

test("상세는 읽기부터 시작하고 수정 취소는 초안을 확인한다", async ({
  page,
}) => {
  await mockLive(page);
  await page.goto("http://127.0.0.1:5175/#/requests/request-one");
  await expect(
    page.getByRole("heading", { name: "요청 내용", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "제목", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "요청 수정", exact: true }).click();
  await page
    .getByRole("textbox", { name: "요청 내용", exact: true })
    .fill("취소하기 전 초안");
  await page.getByRole("button", { name: "수정 취소", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "수정을 취소할까요?" });
  await dialog.getByRole("button", { name: "취소", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "요청 내용", exact: true }),
  ).toHaveValue("취소하기 전 초안");
  await page.getByRole("button", { name: "수정 취소", exact: true }).click();
  await dialog.getByRole("button", { name: "수정 취소", exact: true }).click();
  await expect(page.getByText("원래 요청 내용", { exact: true })).toBeVisible();
});

test("등록 폼은 2단으로 표시하고 저장 실패 시 입력을 보존한다", async ({
  page,
}) => {
  await mockLive(page);
  await page.route("**/rest/v1/rpc/create_request", (r) =>
    r.fulfill({ status: 503, json: { message: "요청 저장 실패" } }),
  );
  await page.goto("http://127.0.0.1:5175/#/requests/new");
  await expect(page.locator(".request-create-grid")).toBeVisible();
  await page.getByRole("textbox", { name: /제목/ }).fill("새 요청 제목");
  await page.getByRole("textbox", { name: /요청 내용/ }).fill("새 요청 내용");
  await page.getByRole("button", { name: "요청 등록", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("요청 저장 실패");
  await expect(page.getByRole("textbox", { name: /제목/ })).toHaveValue(
    "새 요청 제목",
  );
});

test("내 계정은 프로필과 보안을 구분하고 이름 저장 실패를 보존한다", async ({
  page,
}) => {
  await mockLive(page);
  await page.route("**/rest/v1/rpc/update_display_name", (r) =>
    r.fulfill({ status: 503, json: { message: "이름 저장 실패" } }),
  );
  await page.goto("http://127.0.0.1:5175/#/account");
  await expect(
    page.getByRole("heading", { name: "보안", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "표시 이름", exact: true })
    .fill("변경한 이름");
  await page.getByRole("button", { name: "이름 저장", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("이름 저장 실패");
  await expect(
    page.getByRole("textbox", { name: "표시 이름", exact: true }),
  ).toHaveValue("변경한 이름");
});

test("수정 저장 성공은 읽기 화면으로 복귀하고 링크 이탈 취소는 초안을 보존한다", async ({
  page,
}) => {
  await mockLive(page);
  let current = { ...row };
  await page.route("**/rest/v1/requests?*", (r) =>
    r.fulfill({ json: current }),
  );
  await page.route("**/rest/v1/rpc/update_request", (r) => {
    const body = r.request().postDataJSON();
    expect(body.expected_version).toBe(1);
    current = { ...current, ...body.patch, version: 2 };
    return r.fulfill({ json: current });
  });
  await page.goto("http://127.0.0.1:5175/#/requests/request-one");
  await page.getByRole("button", { name: "요청 수정", exact: true }).click();
  await page
    .getByRole("textbox", { name: "요청 내용", exact: true })
    .fill("저장할 새 내용");
  await page
    .getByRole("link", { name: "목록으로 돌아가기", exact: true })
    .click({ noWaitAfter: true });
  await page
    .getByRole("dialog", { name: "수정 중인 화면을 나갈까요?" })
    .getByRole("button", { name: "취소", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "요청 내용", exact: true }),
  ).toHaveValue("저장할 새 내용");
  await page
    .getByRole("button", { name: "변경사항 저장", exact: true })
    .click();
  await expect(page.getByText("저장할 새 내용", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "제목", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "요청 수정", exact: true }),
  ).toBeEnabled();
});

test("모바일 등록·읽기·계정 화면은 가로 넘침 없이 배치된다", async ({
  page,
}) => {
  await mockLive(page);
  await page.setViewportSize({ width: 390, height: 844 });
  for (const route of ["requests/new", "requests/request-one", "account"]) {
    await page.goto("http://127.0.0.1:5175/#/" + route);
    await page.locator("main h1").waitFor();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto("http://127.0.0.1:5175/#/requests/new");
  await expect(page.locator(".request-create-grid")).toBeVisible();
  const left = await page.locator(".request-create-grid>section").boundingBox(),
    right = await page.locator(".request-create-grid>aside").boundingBox();
  expect(right!.y).toBeGreaterThan(left!.y + left!.height);
});

test("등록 고객사가 없으면 입력과 저장을 차단하고 안내한다", async ({
  page,
}) => {
  await mockLive(page);
  await page.route("**/rest/v1/customers?*", (r) => r.fulfill({ json: [] }));
  await page.goto("http://127.0.0.1:5175/#/requests/new");
  await expect(page.getByText(/등록 가능한 고객사가 없습니다/)).toBeVisible();
  await expect(page.getByRole("textbox", { name: /제목/ })).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "요청 등록", exact: true }),
  ).toBeDisabled();
});

test("브라우저 뒤로가기와 로그아웃도 수정 초안을 확인한다", async ({
  page,
}) => {
  await mockLive(page);
  let signouts = 0;
  await page.route("**/auth/v1/logout*", (r) => {
    signouts++;
    return r.fulfill({ json: {} });
  });
  await page.goto("http://127.0.0.1:5175/#/board");
  await page.getByRole("link", { name: "검증 요청 1", exact: true }).click();
  await page.getByRole("button", { name: "요청 수정", exact: true }).click();
  await page
    .getByRole("textbox", { name: "요청 내용", exact: true })
    .fill("이탈 확인 초안");
  await page.evaluate(() => history.back());
  const modal = page.getByRole("dialog", {
    name: "수정 중인 화면을 나갈까요?",
  });
  await modal.getByRole("button", { name: "취소", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "요청 내용", exact: true }),
  ).toHaveValue("이탈 확인 초안");
  await page
    .locator(".sidebar")
    .getByRole("button", { name: "로그아웃", exact: true })
    .click();
  await modal.getByRole("button", { name: "취소", exact: true }).click();
  expect(signouts).toBe(0);
  await page
    .getByRole("link", { name: "목록으로 돌아가기", exact: true })
    .click({ noWaitAfter: true });
  await modal.getByRole("button", { name: "나가기", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "진행 현황", exact: true }),
  ).toBeVisible();
});

test("소개 페이지는 공개이며 섹션 이동과 데모 필터가 연결된다", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5174/#/about");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "운영에는 없는",
  );
  await page
    .getByRole("navigation", { name: "소개 페이지 메뉴" })
    .getByRole("link", { name: "설계 판단", exact: true })
    .click();
  await expect(page.locator("#decisions")).toBeInViewport();
  await page.reload();
  await expect(page.locator("#decisions")).toBeInViewport();
  await page
    .getByRole("link", { name: "운영 미반영 요청 보기", exact: true })
    .click();
  await expect(page).toHaveURL(/#\/board\?deployment=pending$/);
  await expect(page.locator(".request-card")).toHaveCount(3);
});

test("데모에서 소개로 왕복하고 모바일에 가로 넘침이 없다", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("http://127.0.0.1:5174/#/board");
  await page.getByRole("link", { name: "서비스 소개", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "놓치지 않게",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("link", { name: "데모 열어보기", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "진행 현황", exact: true }),
  ).toBeVisible();
});

test("실무 모드의 소개도 로그인 없이 열리며 내부 고객사 API를 호출하지 않는다", async ({
  page,
}) => {
  const dataRequests: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/rest/v1/")) dataRequests.push(r.url());
  });
  await page.goto("http://127.0.0.1:5175/#/about");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "운영에는 없는",
  );
  await expect(
    page.getByRole("link", { name: "서비스 로그인", exact: true }).first(),
  ).toHaveAttribute("href", "#/login");
  expect(dataRequests).toEqual([]);
});

test("카드 빈 영역 클릭과 제목 Enter는 상세를 연다", async ({ page }) => {
  await mockLive(page);
  await page.goto("http://127.0.0.1:5175/#/board");
  await page
    .locator(".request-card")
    .first()
    .click({ position: { x: 8, y: 8 } });
  await expect(
    page.getByRole("heading", { name: "검증할 요청", exact: true }),
  ).toBeVisible();
  await page.goto("http://127.0.0.1:5175/#/board");
  await page.getByRole("link", { name: "검증 요청 1", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "검증할 요청", exact: true }),
  ).toBeVisible();
});

test("카드의 상태 선택은 드래그와 상세 열기를 실행하지 않는다", async ({
  page,
}) => {
  await mockLive(page);
  let writes = 0;
  await page.route("**/rest/v1/rpc/update_request", (r) => {
    writes++;
    expect(r.request().postDataJSON().patch).toEqual({
      status: "verification",
    });
    return r.fulfill({ json: null });
  });
  await page.goto("http://127.0.0.1:5175/#/board");
  await page
    .getByRole("combobox", { name: "검증 요청 1 진행 상태", exact: true })
    .selectOption("verification");
  await expect.poll(() => writes).toBe(1);
  await expect(page).toHaveURL(/#\/board$/);
  await expect(page.locator(".card-drag-preview")).toHaveCount(0);
});

test("키보드 Space와 방향키로 상태를 이동하고 Escape로 취소한다", async ({
  page,
}) => {
  await mockLive(page);
  let writes = 0;
  await page.route("**/rest/v1/rpc/update_request", (r) => {
    writes++;
    expect(r.request().postDataJSON().patch.status).toBe("in_progress");
    return r.fulfill({ json: null });
  });
  await page.goto("http://127.0.0.1:5175/#/board");
  const title = page.getByRole("link", { name: "검증 요청 1", exact: true });
  await title.focus();
  await page.keyboard.press("Space");
  await expect(page.locator(".card-drag-preview")).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(
    page.locator("#lane-in_progress .drop-placeholder"),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".card-drag-preview")).toHaveCount(0);
  expect(writes).toBe(0);
  await title.focus();
  await page.keyboard.press("Space");
  await expect(page.locator(".card-drag-preview")).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(
    page.locator("#lane-in_progress .drop-placeholder"),
  ).toBeVisible();
  await page.keyboard.press("Space");
  await expect.poll(() => writes).toBe(1);
  await expect(page).toHaveURL(/#\/board$/);
});

test("포인터 드래그를 취소한 뒤 첫 정상 클릭은 상세를 연다", async ({
  page,
}) => {
  await mockLive(page);
  let writes = 0;
  await page.route("**/rest/v1/rpc/update_request", (r) => {
    writes++;
    return r.fulfill({ json: null });
  });
  await page.goto("http://127.0.0.1:5175/#/board");
  const card = page.locator(".request-card").first();
  const box = await card.boundingBox();
  await page.mouse.move(box!.x + 20, box!.y + 20);
  await page.mouse.down();
  await page.mouse.move(box!.x + 45, box!.y + 35, { steps: 5 });
  await expect(page.locator(".card-drag-preview")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(page).toHaveURL(/#\/board$/);
  expect(writes).toBe(0);
  await card.click({ position: { x: 8, y: 8 } });
  await expect(
    page.getByRole("heading", { name: "검증할 요청", exact: true }),
  ).toBeVisible();
});

test("모바일은 드래그 없이 상태를 선택하고 데모는 계속 읽기 전용이다", async ({
  page,
}) => {
  await mockLive(page);
  await page.setViewportSize({ width: 390, height: 844 });
  let writes = 0;
  await page.route("**/rest/v1/rpc/update_request", (r) => {
    writes++;
    return r.fulfill({ json: null });
  });
  await page.goto("http://127.0.0.1:5175/#/board");
  await expect(page.locator(".request-card[data-draggable=true]")).toHaveCount(
    0,
  );
  await page
    .getByRole("combobox", { name: "검증 요청 1 진행 상태", exact: true })
    .selectOption("completed");
  await expect.poll(() => writes).toBe(1);
  await page.goto("http://127.0.0.1:5174/#/board");
  await expect(page.locator(".request-card[data-draggable=true]")).toHaveCount(
    0,
  );
  await expect(page.locator(".card-status")).toHaveCount(0);
});
