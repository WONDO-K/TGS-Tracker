import { test } from "node:test";
import assert from "node:assert/strict";
import { createGitHubHandler } from "../supabase/functions/github/handler.ts";
import type {
  Actor,
  GitHubConfig,
  GitHubStore,
  StoredConnection,
  StoredState,
} from "../supabase/functions/github/handler.ts";
import {
  decryptToken,
  encryptToken,
} from "../supabase/functions/github/security.ts";
import { GitHubError } from "../supabase/functions/github/core.ts";

const uid = "00000000-0000-0000-0000-000000000001",
  other = "00000000-0000-0000-0000-000000000002";
const customer = "10000000-0000-0000-0000-000000000001",
  repoId = "20000000-0000-0000-0000-000000000001";
const sourceSha = "a".repeat(40),
  targetSha = "b".repeat(40);
const config: GitHubConfig = {
  appUrl: "https://tracker.test/",
  returnUrls: ["https://tracker.test/"],
  clientId: "test-client",
  clientSecret: "test-secret",
  tokenKey: btoa(String.fromCharCode(...new Uint8Array(32).fill(19))),
  callbackUrl: "https://project.supabase.co/functions/v1/github/callback",
};

function fixture() {
  let time = new Date("2026-11-02T00:00:00Z");
  let active = true;
  let actor: Actor = { id: uid, admin: true, customerIds: [customer] };
  const connections = new Map<string, StoredConnection>(),
    states = new Map<string, StoredState>();
  const repo = {
    id: repoId,
    customerId: customer,
    githubId: 50,
    fullName: "company/private",
    defaultBranch: "main",
  };
  let savedLinks = 0,
    networkCalls = 0,
    exchangeCalls = 0;
  let exchangeGate: Promise<void> = Promise.resolve();
  const store: GitHubStore = {
    async getConnection(id) {
      return connections.get(id) || null;
    },
    async beginOAuth(state) {
      const old = connections.get(state.user_id);
      connections.set(state.user_id, {
        user_id: state.user_id,
        token_ciphertext: null,
        github_user_id: null,
        login: null,
        scopes: null,
        expires_at: null,
        connected_at: null,
        ...old,
        generation: state.generation,
      });
      for (const [key, value] of states)
        if (value.user_id === state.user_id) states.delete(key);
      states.set(state.state_hash, state);
    },
    async consumeState(hash, now, userId) {
      const state = states.get(hash);
      if (
        !state ||
        Date.parse(state.expires_at) <= Date.parse(now) ||
        (userId
          ? state.user_id !== userId || !state.code_ciphertext
          : !!state.code_ciphertext)
      )
        return null;
      states.delete(hash);
      return state;
    },
    async stageOAuth(state) {
      if (connections.get(state.user_id)?.generation !== state.generation)
        return false;
      states.set(state.state_hash, state);
      return true;
    },
    async saveConnection(value) {
      if (connections.get(value.user_id)?.generation !== value.generation)
        return false;
      connections.set(value.user_id, value);
      return true;
    },
    async endConnection(id) {
      const old = connections.get(id);
      if (old)
        connections.set(id, {
          ...old,
          generation: crypto.randomUUID(),
          token_ciphertext: null,
          login: null,
          github_user_id: null,
          scopes: null,
          connected_at: null,
          expires_at: null,
        });
      for (const [key, value] of states)
        if (value.user_id === id) states.delete(key);
    },
    async activeUser() {
      return active;
    },
    async listRepositories() {
      return [repo];
    },
    async getRepository() {
      return repo;
    },
    async attachRepository() {
      return repo;
    },
    async detachRepository() {},
    async listLinks() {
      return [];
    },
    async saveLink() {
      savedLinks++;
    },
    async deleteLink() {},
  };
  const fetchImpl: typeof fetch = async (input, init) => {
    networkCalls++;
    const url = new URL(String(input));
    if (url.hostname === "github.com") {
      exchangeCalls++;
      const body = new URLSearchParams(String(init?.body));
      assert.equal(body.get("client_secret"), config.clientSecret);
      assert.equal(body.get("code"), "provider-code");
      assert.ok(body.get("code_verifier"));
      await exchangeGate;
      return Response.json({
        access_token: "gho_private_test_token",
        scope: "repo",
        expires_in: 3600,
      });
    }
    assert.equal(url.hostname, "api.github.com");
    if (url.pathname === "/user")
      return Response.json({ id: 42, login: "github-person" });
    if (url.pathname.includes("/branches/"))
      return Response.json({
        name: url.pathname.endsWith("develop") ? "develop" : "main",
        commit: {
          sha: url.pathname.endsWith("develop") ? sourceSha : targetSha,
        },
      });
    if (url.pathname.includes("/compare/"))
      return Response.json({ status: "ahead" });
    if (url.pathname.includes("/applications/"))
      return new Response(null, { status: 204 });
    return Response.json({
      id: 50,
      full_name: "company/private",
      default_branch: "main",
      private: true,
    });
  };
  const handler = createGitHubHandler({
    config,
    store,
    fetchImpl,
    now: () => time,
    authenticate: async (token) => {
      if (token !== "tgs-session")
        throw new GitHubError("unauthorized", "로그인이 필요합니다.", 401);
      if (!active)
        throw new GitHubError("account_inactive", "차단 계정입니다.", 403);
      return actor;
    },
  });
  const post = (
    body: Record<string, unknown>,
    token = "tgs-session",
    origin = "https://tracker.test",
  ) =>
    handler(
      new Request("https://project.supabase.co/functions/v1/github", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Origin: origin,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      }),
    );
  const start = async () => {
    const response = await post({
      action: "connect",
      returnUrl: config.appUrl,
    });
    assert.equal(response.status, 200);
    return new URL((await response.json()).url);
  };
  const callback = (state: string, extra = "code=provider-code") =>
    handler(new Request(`${config.callbackUrl}?state=${state}&${extra}`));
  const ticket = (response: Response) =>
    new URLSearchParams(
      new URL(response.headers.get("location")!).hash.split("?")[1],
    ).get("ticket")!;
  return {
    handler,
    post,
    start,
    callback,
    ticket,
    connections,
    states,
    store,
    counts: () => ({ savedLinks, networkCalls, exchangeCalls }),
    setActor: (value: Actor) => {
      actor = value;
    },
    setActive: (value: boolean) => {
      active = value;
    },
    setTime: (value: Date) => {
      time = value;
    },
    setGate: (value: Promise<void>) => {
      exchangeGate = value;
    },
  };
}

test("GitHub 인증 상태는 TGS 인증과 정확한 Origin을 요구하고 비밀을 응답하지 않는다", async () => {
  const f = fixture();
  assert.equal((await f.post({ action: "status" }, "bad")).status, 401);
  assert.equal(
    (await f.post({ action: "status" }, "tgs-session", "https://evil.test"))
      .status,
    403,
  );
  const response = await f.post({ action: "status", userId: other });
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {
    configured: true,
    connected: false,
    reason: "disconnected",
  });
  f.setActive(false);
  assert.equal((await f.post({ action: "status" })).status, 403);
});

test("OAuth 콜백만으로는 연결하지 않고 같은 TGS 계정이 일회성 티켓으로 완료한다", async () => {
  const f = fixture(),
    start = await f.start();
  const state = start.searchParams.get("state")!;
  const callback = await f.callback(state);
  assert.equal(callback.status, 303);
  assert.ok(
    callback.headers
      .get("location")!
      .startsWith(config.appUrl + "#/commits?github=pending"),
  );
  assert.equal(f.counts().exchangeCalls, 0);
  assert.equal(f.connections.get(uid)?.token_ciphertext, null);
  const completion = f.ticket(callback);
  f.setActor({ id: other, admin: false, customerIds: [] });
  assert.equal(
    (await f.post({ action: "complete", ticket: completion })).status,
    400,
  );
  assert.equal(f.counts().exchangeCalls, 0);
  f.setActor({ id: uid, admin: true, customerIds: [customer] });
  const done = await f.post({ action: "complete", ticket: completion });
  assert.equal(done.status, 200);
  const connection = f.connections.get(uid)!;
  assert.ok(!connection.token_ciphertext!.includes("gho_private_test_token"));
  assert.equal(
    await decryptToken(connection.token_ciphertext!, config.tokenKey, uid),
    "gho_private_test_token",
  );
  const status = JSON.stringify(
    await (await f.post({ action: "status" })).json(),
  );
  assert.ok(status.includes("github-person"));
  assert.ok(
    !status.includes("private_test_token") &&
      !status.includes("ciphertext") &&
      !status.includes("test-secret"),
  );
  assert.equal(
    (await f.post({ action: "complete", ticket: completion })).status,
    400,
  );
  assert.ok(
    (await f.callback(state)).headers.get("location")!.includes("github=error"),
  );
  assert.equal(f.counts().exchangeCalls, 1);
});

test("OAuth 취소·만료·잘못된 복귀 주소는 연결을 만들지 않는다", async () => {
  const f = fixture();
  assert.notEqual(
    (await f.post({ action: "connect", returnUrl: "https://evil.test/" }))
      .status,
    200,
  );
  const a = await f.start();
  assert.ok(
    (
      await f.callback(a.searchParams.get("state")!, "error=access_denied")
    ).headers
      .get("location")!
      .includes("github=denied"),
  );
  const b = await f.start();
  f.setTime(new Date("2026-11-02T00:11:00Z"));
  assert.ok(
    (await f.callback(b.searchParams.get("state")!)).headers
      .get("location")!
      .includes("github=error"),
  );
  assert.equal(f.counts().networkCalls, 0);
});

test("마지막 슬래시 없는 복귀 주소 설정도 일관되게 정규화한다", async () => {
  const f = fixture();
  const handler = createGitHubHandler({
    config: { ...config, returnUrls: ["https://tracker.test"] },
    store: f.store,
    authenticate: async () => ({
      id: uid,
      admin: true,
      customerIds: [customer],
    }),
  });
  const start = await handler(
    new Request("https://project.supabase.co/functions/v1/github", {
      method: "POST",
      headers: {
        Authorization: "Bearer session",
        Origin: "https://tracker.test",
      },
      body: JSON.stringify({
        action: "connect",
        returnUrl: "https://tracker.test/",
      }),
    }),
  );
  assert.equal(start.status, 200);
  const state = new URL((await start.json()).url).searchParams.get("state")!;
  const callback = await handler(
    new Request(`${config.callbackUrl}?state=${state}&code=provider-code`),
  );
  assert.ok(
    callback.headers
      .get("location")!
      .startsWith("https://tracker.test/#/commits?github=pending"),
  );
});

test("연결 해제 중 늦은 완료 응답이 계정을 다시 연결하지 않는다", async () => {
  const f = fixture(),
    start = await f.start();
  const completion = f.ticket(
    await f.callback(start.searchParams.get("state")!),
  );
  let release!: () => void;
  f.setGate(
    new Promise<void>((resolve) => {
      release = resolve;
    }),
  );
  const done = f.post({ action: "complete", ticket: completion });
  while (!f.counts().exchangeCalls)
    await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal((await f.post({ action: "disconnect" })).status, 200);
  release();
  assert.equal((await done).status, 400);
  assert.equal(f.connections.get(uid)!.token_ciphertext, null);
});

test("다른 고객사 저장소와 비관리자 저장소 등록을 거절한다", async () => {
  const f = fixture(),
    start = await f.start();
  await f.post({
    action: "complete",
    ticket: f.ticket(await f.callback(start.searchParams.get("state")!)),
  });
  const before = f.counts().networkCalls;
  f.setActor({ id: uid, admin: false, customerIds: [] });
  assert.equal(
    (await f.post({ action: "commit", repositoryId: repoId, sha: sourceSha }))
      .status,
    403,
  );
  assert.equal(f.counts().networkCalls, before);
  f.setActor({ id: uid, admin: false, customerIds: [customer] });
  assert.equal(
    (
      await f.post({
        action: "attachRepository",
        customerId: customer,
        fullName: "company/private",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await f.post({
        action: "saveLink",
        repositoryId: repoId,
        baseBranch: "develop",
        targetBranch: "main",
        sourceSha,
        targetSha,
      })
    ).status,
    200,
  );
  assert.equal(f.counts().savedLinks, 1);
});
