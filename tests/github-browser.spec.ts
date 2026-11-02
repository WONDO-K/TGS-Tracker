import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
const user = {
  id: "00000000-0000-0000-0000-000000000001",
  aud: "authenticated",
  role: "authenticated",
  email: "fixture@test.local",
  email_confirmed_at: "2026-01-01T00:00:00Z",
  app_metadata: { provider: "email", providers: ["email"] },
  user_metadata: {},
  identities: [],
  created_at: "2026-01-01T00:00:00Z",
};
const source = "a".repeat(40),
  target = "b".repeat(40);
const summary = {
  sha: source,
  title: "합성 변경 커밋",
  message: "합성 변경 커밋",
  author: "Fixture",
  date: "2026-11-01T00:00:00Z",
  url: "https://github.com/fixture/project/commit/" + source,
};
const repository = {
  id: "repo-one",
  customerId: "customer-one",
  githubId: 1,
  fullName: "fixture/project",
  defaultBranch: "main",
};
type Reply = { status?: number; body: unknown };
async function mockLive(
  page: Page,
  options: {
    admin?: boolean;
    authenticated?: boolean;
    handle?: (
      body: Record<string, unknown>,
    ) => Promise<Reply | undefined> | Reply | undefined;
  } = {},
) {
  if (options.authenticated !== false) {
    const token =
      "eyJhbGciOiJIUzI1NiJ9." +
      Buffer.from(
        JSON.stringify({
          sub: user.id,
          role: "authenticated",
          exp: Math.floor(Date.now() / 1000) + 3600,
        }),
      ).toString("base64url") +
      ".fixture";
    await page.addInitScript(
      ({ user, token }) =>
        localStorage.setItem(
          "sb-test-project-auth-token",
          JSON.stringify({
            access_token: token,
            refresh_token: "fixture-refresh",
            expires_at: Math.floor(Date.now() / 1000) + 3600,
            expires_in: 3600,
            token_type: "bearer",
            user,
          }),
        ),
      { user, token },
    );
  }
  const calls: Record<string, unknown>[] = [];
  await page.route("https://test-project.supabase.co/**", async (route) => {
    const url = new URL(route.request().url());
    let body: unknown = [];
    if (url.pathname === "/functions/v1/github") {
      const request = route.request().postDataJSON() as Record<string, unknown>;
      calls.push(request);
      const custom = await options.handle?.(request);
      if (custom) {
        await route.fulfill({
          status: custom.status || 200,
          json: custom.body,
        });
        return;
      }
      switch (request.action) {
        case "status":
          body = { configured: true, connected: true, login: "fixture-user" };
          break;
        case "repositories":
          body = {
            repositories:
              request.customerId === "customer-one" ? [repository] : [],
          };
          break;
        case "branches":
          body = {
            branches: [
              { name: "main", sha: target },
              { name: "develop", sha: source },
            ],
            hasMore: false,
          };
          break;
        case "compare":
          body = {
            repositoryId: repository.id,
            baseBranch: request.baseBranch,
            targetBranch: request.targetBranch,
            baseSha: source,
            targetSha: target,
            since: "2026-10-03T00:00:00Z",
            comparedAt: "2026-11-02T00:00:00Z",
            sourceComplete: true,
            targetComplete: true,
            sourceScanned: 1,
            targetScanned: 1,
            rows: [
              {
                ...summary,
                result: "review",
                evidence: "메시지 후보",
                candidates: [
                  { ...summary, sha: target, title: "합성 대상 커밋" },
                ],
              },
            ],
          };
          break;
        case "commit":
          body = {
            ...summary,
            sha: request.sha === source ? source : target,
            title: request.sha === source ? summary.title : "합성 대상 커밋",
            filesComplete: true,
            files: [
              {
                name: "src/fixture.ts",
                added: 1,
                removed: 1,
                status: "modified",
                patch: "@@ -1 +1 @@\n-old\n+new",
              },
            ],
          };
          break;
        case "saveLink":
          body = {
            link: {
              sourceSha: source,
              targetSha: target,
              baseBranch: request.baseBranch,
              targetBranch: request.targetBranch,
              confirmedBy: "server-reviewer",
              confirmedAt: "2026-11-02T01:00:00Z",
            },
          };
          break;
        case "deleteLink":
        case "disconnect":
        case "detachRepository":
          body = { ok: true };
          break;
        case "accessibleRepositories":
          body = {
            repositories: [
              {
                githubId: 2,
                fullName: "fixture/second",
                defaultBranch: "main",
                private: true,
              },
            ],
            hasMore: false,
          };
          break;
        case "attachRepository":
          body = { repository };
          break;
        default:
          throw new Error("Unexpected GitHub action: " + request.action);
      }
    } else if (url.pathname === "/auth/v1/user") body = user;
    else if (url.pathname.endsWith("/profiles"))
      body = {
        ...user,
        display_name: "합성 담당자",
        is_active: true,
        role: options.admin ? "admin" : "member",
      };
    else if (url.pathname.endsWith("/customers"))
      body = [
        {
          id: "customer-one",
          name: "합성 고객사 A",
          code: "A",
          is_active: true,
        },
        {
          id: "customer-two",
          name: "합성 고객사 B",
          code: "B",
          is_active: true,
        },
      ];
    else if (url.pathname.endsWith("/get_people"))
      body = [{ id: user.id, display_name: "합성 담당자" }];
    await route.fulfill({ json: body });
  });
  return calls;
}
const open = (page: Page, suffix = "") =>
  page.goto("http://127.0.0.1:5175/#/commits" + suffix);

test("GitHub status network failure shows a recoverable failure instead of endless loading", async ({
  page,
}) => {
  await mockLive(page, {
    handle: (b) =>
      b.action === "status"
        ? {
            status: 503,
            body: {
              error: {
                code: "github_unavailable",
                message: "연동 서버에 연결하지 못했습니다.",
              },
            },
          }
        : undefined,
  });
  await open(page);
  await expect(
    page.getByRole("heading", { name: "GitHub 연결을 확인하지 못했습니다" }),
  ).toBeVisible();
  await expect(page.getByText(/docs\/github-setup.md/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "GitHub 연결", exact: true }),
  ).toBeDisabled();
});

test("GitHub customer selection excludes inactive customers", async ({
  page,
}) => {
  await mockLive(page);
  await page.route("**/rest/v1/customers*", (route) =>
    route.fulfill({
      json: [
        {
          id: "customer-inactive",
          name: "중지 고객사",
          code: "OFF",
          is_active: false,
        },
        {
          id: "customer-one",
          name: "합성 고객사 A",
          code: "A",
          is_active: true,
        },
      ],
    }),
  );
  await open(page);
  await expect(
    page.getByRole("combobox", { name: "고객사", exact: true }),
  ).toHaveValue("customer-one");
  await expect(
    page.getByRole("option", { name: "중지 고객사", exact: true }),
  ).toHaveCount(0);
});

test("GitHub confirmation closes when the authenticated actor changes", async ({
  page,
}) => {
  const calls = await mockLive(page);
  await open(page);
  await page.getByText("GitHub · fixture-user", { exact: true }).click();
  await page
    .getByRole("button", { name: "GitHub 연결 해제", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  const nextUser = {
    ...user,
    id: "00000000-0000-0000-0000-000000000002",
    email: "other@test.local",
  };
  await page.route("**/auth/v1/user", (route) =>
    route.fulfill({ json: nextUser }),
  );
  await page.route("**/rest/v1/profiles*", (route) =>
    route.fulfill({
      json: {
        ...nextUser,
        display_name: "다른 계정",
        is_active: true,
        role: "member",
      },
    }),
  );
  await page.evaluate((u) => {
    const stored = JSON.parse(
      localStorage.getItem("sb-test-project-auth-token")!,
    );
    stored.user = u;
    localStorage.setItem("sb-test-project-auth-token", JSON.stringify(stored));
    document.dispatchEvent(new Event("visibilitychange"));
  }, nextUser);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(calls.filter((c) => c.action === "disconnect")).toHaveLength(0);
});
async function compare(page: Page) {
  await expect(
    page.getByRole("combobox", { name: "기준 브랜치", exact: true }),
  ).toHaveValue("develop");
  await page.getByRole("button", { name: "대조하기", exact: true }).click();
  await expect(
    page.getByRole("button", { name: summary.title, exact: true }),
  ).toBeVisible();
}

test("GitHub unconfigured status explains setup and keeps synthetic preview available", async ({
  page,
}) => {
  await mockLive(page, {
    handle: (b) =>
      b.action === "status"
        ? {
            body: {
              configured: false,
              connected: false,
              reason: "not_configured",
            },
          }
        : undefined,
  });
  await open(page);
  await expect(
    page.getByRole("button", { name: "GitHub 연결", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText("GitHub 연동 설정이 아직 완료되지 않았습니다.", {
      exact: false,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "가상 데이터로 미리보기" }).click();
  await expect(page.getByText("UI 미리보기 · 가상 데이터")).toBeVisible();
});

test("GitHub connect uses function URL and processes callback notice without credentials", async ({
  page,
}) => {
  const calls = await mockLive(page, {
    handle: (b) =>
      b.action === "status"
        ? { body: { configured: true, connected: false } }
        : b.action === "connect"
          ? {
              body: {
                url: "https://github.com/login/oauth/authorize?client_id=fixture&state=synthetic",
              },
            }
          : undefined,
  });
  await page.route("https://github.com/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<p>Synthetic OAuth boundary</p>",
    }),
  );
  await open(page, "?github=denied");
  await expect(
    page.getByText("GitHub 연결 승인이 취소되었습니다.", { exact: false }),
  ).toBeVisible();
  await expect(page).toHaveURL(/#\/commits$/);
  await page.getByRole("button", { name: "GitHub 연결", exact: true }).click();
  await expect(page).toHaveURL(
    /^https:\/\/github.com\/login\/oauth\/authorize/,
  );
  expect(calls.find((c) => c.action === "connect")?.returnUrl).toBe(
    "http://127.0.0.1:5175/",
  );
});

test("live compare fetches files, verifies target and persists server confirmation", async ({
  page,
}) => {
  const calls = await mockLive(page);
  await open(page);
  await compare(page);
  await expect(
    page.getByText("저장소 등록·해제는 관리자에게 요청해주세요.", {
      exact: false,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: summary.title, exact: true }).click();
  await page.getByRole("button", { name: "변경 파일", exact: true }).click();
  await expect(page.getByText("src/fixture.ts", { exact: true })).toBeVisible();
  await expect(page.locator(".commit-patch")).toContainText("+new");
  await page.getByRole("button", { name: "대응 근거", exact: true }).click();
  await page
    .getByRole("textbox", { name: "대응 커밋 SHA", exact: true })
    .fill(target.slice(0, 7));
  await expect(
    page.getByRole("button", { name: "대응 저장", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "대응 커밋 확인", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "대응 저장", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "대응 저장", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "저장", exact: true })
    .click();
  await expect(
    page.getByText("server-reviewer", { exact: false }),
  ).toBeVisible();
  expect(calls.find((c) => c.action === "saveLink")).toMatchObject({
    sourceSha: source,
    targetSha: target,
    baseBranch: "develop",
    targetBranch: "main",
  });
});

test("transient failure retains last result but permission failure hides private rows", async ({
  page,
}) => {
  let count = 0;
  await mockLive(page, {
    handle: (b) => {
      if (b.action !== "compare" || ++count === 1) return;
      return {
        status: count === 2 ? 503 : 403,
        body: {
          error: {
            code: count === 2 ? "github_unavailable" : "github_permission",
            message: count === 2 ? "일시 조회 실패" : "접근 권한 없음",
          },
        },
      };
    },
  });
  await open(page);
  await compare(page);
  await page.getByRole("button", { name: "대조하기", exact: true }).click();
  await expect(
    page.getByText("일시 조회 실패", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: summary.title, exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "다시 조회", exact: true }).click();
  await expect(
    page.getByRole("button", { name: summary.title, exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "GitHub 접근 권한을 확인해주세요" }),
  ).toBeVisible();
});

test("failed manual save does not mark correspondence as saved", async ({
  page,
}) => {
  await mockLive(page, {
    handle: (b) =>
      b.action === "saveLink"
        ? {
            status: 400,
            body: {
              error: {
                code: "invalid_input",
                message: "대상 브랜치에 포함되지 않은 커밋입니다.",
              },
            },
          }
        : undefined,
  });
  await open(page);
  await compare(page);
  await page.getByRole("button", { name: summary.title, exact: true }).click();
  await page
    .getByRole("textbox", { name: "대응 커밋 SHA", exact: true })
    .fill(target);
  await page
    .getByRole("button", { name: "대응 커밋 확인", exact: true })
    .click();
  await page.getByRole("button", { name: "대응 저장", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "저장", exact: true })
    .click();
  await expect(
    page.getByText("대상 브랜치에 포함되지 않은 커밋입니다.", { exact: false }),
  ).toBeVisible();
  await expect(page.getByText("server-reviewer", { exact: false })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("button", { name: "대응 저장", exact: true }),
  ).toBeVisible();
});

test("late comparison cannot restore private data after customer change", async ({
  page,
}) => {
  let release!: () => void;
  let requested!: () => void;
  const started = new Promise<void>((r) => {
    requested = r;
  });
  const pending = new Promise<void>((r) => {
    release = r;
  });
  await mockLive(page, {
    handle: async (b) => {
      if (b.action === "compare") {
        requested();
        await pending;
      }
      return undefined;
    },
  });
  await open(page);
  await expect(
    page.getByRole("combobox", { name: "기준 브랜치", exact: true }),
  ).toHaveValue("develop");
  await page.getByRole("button", { name: "대조하기", exact: true }).click();
  await started;
  await page
    .getByRole("combobox", { name: "고객사", exact: true })
    .selectOption("customer-two");
  release();
  await expect(
    page.getByRole("heading", { name: "등록된 저장소가 없습니다" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: summary.title, exact: true }),
  ).toHaveCount(0);
});

test("admin maps accessible repositories to the selected customer", async ({
  page,
}) => {
  const calls = await mockLive(page, { admin: true });
  await open(page);
  await expect(
    page.getByRole("combobox", { name: "기준 브랜치", exact: true }),
  ).toHaveValue("develop");
  await page.getByText("고객사 저장소 관리", { exact: true }).click();
  await page
    .getByRole("button", { name: "접근 가능한 저장소 조회", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "등록할 저장소", exact: true })
    .selectOption("fixture/second");
  await page
    .getByRole("button", { name: "고객사에 등록", exact: true })
    .click();
  await expect(
    page.getByText("고객사 저장소를 등록했습니다.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "기준 브랜치", exact: true }),
  ).toHaveValue("develop");
  await expect(
    page.getByRole("combobox", { name: "비교 대상 브랜치", exact: true }),
  ).toHaveValue("main");
  await expect(
    page.getByRole("button", { name: "대조하기", exact: true }),
  ).toBeEnabled();
  await compare(page);
  expect(calls.find((c) => c.action === "attachRepository")).toMatchObject({
    customerId: "customer-one",
    fullName: "fixture/second",
  });
});

test("signed out app does not query GitHub", async ({ page }) => {
  const calls = await mockLive(page, { authenticated: false });
  await open(page);
  await expect(
    page.getByRole("button", { name: "로그인", exact: true }),
  ).toBeVisible();
  expect(calls).toEqual([]);
});

test("live mobile detail restores focus without horizontal overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockLive(page);
  await open(page);
  await compare(page);
  await page.getByRole("button", { name: summary.title, exact: true }).click();
  await expect(
    page.getByRole("region", { name: "커밋 상세", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("button", { name: "목록으로 돌아가기", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: summary.title, exact: true }),
  ).toBeFocused();
});

test("disconnect discards a late private commit detail", async ({ page }) => {
  let release!: () => void;
  let requested!: () => void;
  const started = new Promise<void>((r) => {
    requested = r;
  });
  const pending = new Promise<void>((r) => {
    release = r;
  });
  let disconnected = false;
  await mockLive(page, {
    handle: async (b) => {
      if (b.action === "commit") {
        requested();
        await pending;
      }
      if (b.action === "disconnect") disconnected = true;
      if (b.action === "status" && disconnected)
        return { body: { configured: true, connected: false } };
      return undefined;
    },
  });
  await open(page);
  await compare(page);
  await page.getByRole("button", { name: summary.title, exact: true }).click();
  await started;
  await page.locator(".commit-connection summary").click();
  await page
    .getByRole("button", { name: "GitHub 연결 해제", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "해제", exact: true })
    .click();
  release();
  await expect(
    page.getByRole("heading", { name: "GitHub 연결부터 시작하세요" }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "커밋 상세", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: summary.title, exact: true }),
  ).toHaveCount(0);
});

test("pending OAuth ticket is cleared then completed with current authenticated session", async ({
  page,
}) => {
  let completed = false;
  const calls = await mockLive(page, {
    handle: (b) => {
      if (b.action === "complete") {
        completed = true;
        return { body: { ok: true } };
      }
      if (b.action === "status")
        return {
          body: {
            configured: true,
            connected: completed,
            login: completed ? "fixture-user" : undefined,
          },
        };
      return undefined;
    },
  });
  const ticket = "x".repeat(43);
  await open(page, "?github=pending&ticket=" + ticket);
  await expect(page).toHaveURL(/#\/commits$/);
  await expect(
    page.getByText("GitHub 연결을 완료했습니다.", { exact: true }),
  ).toBeVisible();
  expect(calls.filter((c) => c.action === "complete")).toHaveLength(1);
  expect(calls.find((c) => c.action === "complete")).toEqual({
    action: "complete",
    ticket,
  });
  expect(calls.findIndex((c) => c.action === "complete")).toBeLessThan(
    calls.findIndex((c) => c.action === "status"),
  );
  expect(
    await page.evaluate(
      (ticket) =>
        Object.values(localStorage).some((value) => value.includes(ticket)),
      ticket,
    ),
  ).toBe(false);
});

test("failed pending OAuth completion never displays a connected notice", async ({
  page,
}) => {
  await mockLive(page, {
    handle: (b) =>
      b.action === "complete"
        ? {
            status: 403,
            body: {
              error: {
                code: "oauth_state_invalid",
                message: "다른 계정의 연결 승인입니다.",
              },
            },
          }
        : undefined,
  });
  await open(page, "?github=pending&ticket=" + "y".repeat(43));
  await expect(page).toHaveURL(/#\/commits$/);
  await expect(
    page.getByText("GitHub 연결을 완료하지 못했습니다. 다시 연결해주세요.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("GitHub 연결을 완료했습니다.", { exact: true }),
  ).toHaveCount(0);
});

for (const action of ["disconnect", "saveLink", "detachRepository"] as const) {
  test(`confirmation for ${action} cannot act after customer scope changes`, async ({
    page,
  }) => {
    const calls = await mockLive(page, { admin: true });
    await open(page);
    await expect(
      page.getByRole("combobox", { name: "기준 브랜치", exact: true }),
    ).toHaveValue("develop");
    if (action === "saveLink") {
      await compare(page);
      await page
        .getByRole("button", { name: summary.title, exact: true })
        .click();
      await page
        .getByRole("textbox", { name: "대응 커밋 SHA", exact: true })
        .fill(target);
      await page
        .getByRole("button", { name: "대응 커밋 확인", exact: true })
        .click();
      await page
        .getByRole("button", { name: "대응 저장", exact: true })
        .click();
    } else if (action === "disconnect") {
      await page.locator(".commit-connection summary").click();
      await page
        .getByRole("button", { name: "GitHub 연결 해제", exact: true })
        .click();
    } else {
      await page.getByText("고객사 저장소 관리", { exact: true }).click();
      await page
        .getByRole("button", { name: "선택 저장소 등록 해제", exact: true })
        .click();
    }
    await expect(page.getByRole("dialog")).toBeVisible();
    // Model an external scope update while the native modal blocks normal background clicks.
    await page
      .getByRole("combobox", { name: "고객사", exact: true })
      .evaluate((select) => {
        (select as HTMLSelectElement).value = "customer-two";
        select.dispatchEvent(new Event("change", { bubbles: true }));
      });
    await page
      .getByRole("dialog")
      .getByRole("button", {
        name:
          action === "saveLink"
            ? "저장"
            : action === "disconnect"
              ? "해제"
              : "등록 해제",
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("heading", {
        name: "등록된 저장소가 없습니다",
        exact: true,
      }),
    ).toBeVisible();
    expect(calls.filter((c) => c.action === action)).toEqual([]);
  });
}

test("transport refuses a changed session actor after a pending confirmation", async ({
  page,
}) => {
  const calls = await mockLive(page);
  await open(page);
  await expect(
    page.getByRole("combobox", { name: "기준 브랜치", exact: true }),
  ).toHaveValue("develop");
  await page.locator(".commit-connection summary").click();
  await page
    .getByRole("button", { name: "GitHub 연결 해제", exact: true })
    .click();
  // No auth event: exercise the transport guard independently of provider dialog cancellation.
  await page.evaluate(() => {
    const key = "sb-test-project-auth-token";
    const session = JSON.parse(localStorage.getItem(key)!);
    session.user.id = "00000000-0000-0000-0000-000000000002";
    session.access_token =
      "eyJhbGciOiJIUzI1NiJ9." +
      btoa(
        JSON.stringify({
          sub: session.user.id,
          role: "authenticated",
          exp: Math.floor(Date.now() / 1000) + 3600,
        }),
      ).replace(/=/g, "") +
      ".fixture";
    localStorage.setItem(key, JSON.stringify(session));
  });
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "해제", exact: true })
    .click();
  await expect(
    page.getByText("로그인 계정이 변경되었거나 만료되었습니다.", {
      exact: false,
    }),
  ).toBeVisible();
  expect(calls.filter((c) => c.action === "disconnect")).toEqual([]);
});
