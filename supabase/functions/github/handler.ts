import { GitHubClient, GitHubError } from "./core.ts";
import {
  allowedReturnUrl,
  decryptToken,
  encryptToken,
  hashState,
  makeOAuthRequest,
  validTokenKey,
} from "./security.ts";
import type { GitHubRepository, ManualLink } from "./contracts.ts";

export type Actor = { id: string; admin: boolean; customerIds: string[] };
export type StoredConnection = {
  user_id: string;
  generation: string;
  token_ciphertext: string | null;
  github_user_id: number | null;
  login: string | null;
  scopes: string | null;
  expires_at: string | null;
  connected_at: string | null;
};
export type StoredState = {
  state_hash: string;
  user_id: string;
  generation: string;
  code_verifier: string;
  return_url: string;
  expires_at: string;
  code_ciphertext?: string | null;
};
export type GitHubConfig = {
  appUrl: string;
  returnUrls: string[];
  clientId: string;
  clientSecret: string;
  tokenKey: string;
  callbackUrl: string;
};
export interface GitHubStore {
  getConnection(userId: string): Promise<StoredConnection | null>;
  beginOAuth(state: StoredState): Promise<void>;
  consumeState(
    hash: string,
    now: string,
    userId?: string,
  ): Promise<StoredState | null>;
  stageOAuth(state: StoredState): Promise<boolean>;
  saveConnection(connection: StoredConnection): Promise<boolean>;
  endConnection(userId: string): Promise<void>;
  activeUser(userId: string): Promise<boolean>;
  listRepositories(customerId: string): Promise<GitHubRepository[]>;
  getRepository(id: string): Promise<GitHubRepository | null>;
  attachRepository(
    customerId: string,
    repo: { githubId: number; fullName: string; defaultBranch: string },
    actorId: string,
  ): Promise<GitHubRepository>;
  detachRepository(id: string): Promise<void>;
  listLinks(
    repositoryId: string,
    base: string,
    target: string,
    sourceShas: string[],
  ): Promise<ManualLink[]>;
  saveLink(repositoryId: string, link: ManualLink): Promise<void>;
  deleteLink(
    repositoryId: string,
    base: string,
    target: string,
    sourceSha: string,
  ): Promise<void>;
}
type Dependencies = {
  config: GitHubConfig;
  store: GitHubStore;
  authenticate: (token: string) => Promise<Actor>;
  fetchImpl?: typeof fetch;
  now?: () => Date;
};
function fail(code: string, message: string, status = 400): never {
  throw new GitHubError(code, message, status);
}
const string = (value: unknown, max = 250) =>
  typeof value === "string" && value.length > 0 && value.length <= max
    ? value
    : fail("invalid_input", "입력값을 확인해주세요.");
const uuid = (value: unknown) => {
  const s = string(value, 36);
  if (!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(s))
    fail("invalid_input", "고객사 또는 저장소를 확인해주세요.");
  return s;
};
const sha = (value: unknown, full = false) => {
  const s = string(value, 40);
  if (!(full ? /^[a-f0-9]{40}$/i : /^[a-f0-9]{7,40}$/i).test(s))
    fail("invalid_input", "올바른 커밋 SHA를 입력해주세요.");
  return s.toLowerCase();
};
const branches = (body: Record<string, unknown>) => {
  const base = string(body.baseBranch),
    target = string(body.targetBranch);
  if (
    base === target ||
    [base, target].some(
      (v) => /[\x00-\x20~^:?*\[\\]/.test(v) || v.includes(".."),
    )
  )
    fail("invalid_input", "서로 다른 올바른 브랜치를 선택해주세요.");
  return { base, target };
};
export function createGitHubHandler(deps: Dependencies) {
  const { config, store } = deps,
    fetchImpl = deps.fetchImpl || fetch,
    now = deps.now || (() => new Date());
  const validReturns = config.returnUrls.flatMap((value) => {
    try {
      return [allowedReturnUrl(value, config.returnUrls)];
    } catch {
      return [];
    }
  });
  const origins = new Set(validReturns.map((value) => new URL(value).origin));
  const configured = Boolean(
    config.clientId &&
    config.clientSecret &&
    config.callbackUrl &&
    validTokenKey(config.tokenKey) &&
    validReturns.length,
  );
  const callbackTarget = (root: string, status: string, ticket?: string) => {
    const url = new URL(root);
    const params = new URLSearchParams({ github: status });
    if (ticket) params.set("ticket", ticket);
    url.hash = `/commits?${params}`;
    return url.href;
  };
  const completeOAuth = async (pending: StoredState) => {
    const current = await store.getConnection(pending.user_id);
    if (current?.generation !== pending.generation || !pending.code_ciphertext)
      fail("oauth_state_invalid", "인증 요청을 다시 시작해주세요.");
    const code = await decryptToken(
      pending.code_ciphertext,
      config.tokenKey,
      `oauth-code:${pending.user_id}`,
    );
    const response = await fetchImpl(
      "https://github.com/login/oauth/access_token",
      {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(15000),
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          client_id: config.clientId,
          client_secret: config.clientSecret,
          redirect_uri: config.callbackUrl,
          code,
          code_verifier: pending.code_verifier,
        }),
      },
    );
    if (!response.ok)
      fail("github_unavailable", "GitHub 인증을 다시 시도해주세요.", 502);
    const grant = await response.json();
    if (
      typeof grant.access_token !== "string" ||
      grant.error ||
      typeof grant.scope !== "string" ||
      !grant.scope.split(/[ ,]+/).includes("repo")
    )
      fail("github_permission", "저장소 접근 권한을 승인해주세요.", 403);
    const identity = await new GitHubClient(grant.access_token, {
      fetchImpl,
      now,
    }).getUser();
    if (
      !Number.isSafeInteger(identity.id) ||
      identity.id <= 0 ||
      typeof identity.login !== "string"
    )
      fail(
        "github_unavailable",
        "GitHub 계정 정보를 확인하지 못했습니다.",
        502,
      );
    if (!(await store.activeUser(pending.user_id)))
      fail("account_inactive", "활성 계정이 아닙니다.", 403);
    const saved = await store.saveConnection({
      user_id: pending.user_id,
      generation: pending.generation,
      token_ciphertext: await encryptToken(
        grant.access_token,
        config.tokenKey,
        pending.user_id,
      ),
      github_user_id: identity.id,
      login: identity.login,
      scopes: grant.scope,
      expires_at:
        typeof grant.expires_in === "number" && grant.expires_in > 0
          ? new Date(now().getTime() + grant.expires_in * 1000).toISOString()
          : null,
      connected_at: now().toISOString(),
    });
    if (!saved)
      fail("oauth_state_invalid", "연결 요청이 취소되었거나 변경되었습니다.");
  };
  const api = async (actor: Actor) => {
    const connection = await store.getConnection(actor.id);
    if (!connection?.token_ciphertext)
      fail("github_disconnected", "GitHub 계정을 연결해주세요.", 401);
    if (
      connection.expires_at &&
      Date.parse(connection.expires_at) <= now().getTime()
    )
      fail(
        "github_expired",
        "GitHub 연결이 만료되었습니다. 다시 연결해주세요.",
        401,
      );
    const token = await decryptToken(
      connection.token_ciphertext,
      config.tokenKey,
      actor.id,
    );
    return {
      github: new GitHubClient(token, { fetchImpl, now }),
      connection,
      token,
    };
  };
  const customer = (actor: Actor, id: string) => {
    if (!actor.customerIds.includes(id))
      fail("customer_forbidden", "담당 고객사 접근 권한이 없습니다.", 403);
  };
  const repository = async (actor: Actor, value: unknown) => {
    const repo = await store.getRepository(uuid(value));
    if (!repo)
      fail(
        "repository_inactive",
        "사용 가능한 저장소를 찾을 수 없습니다.",
        404,
      );
    customer(actor, repo.customerId);
    return repo;
  };
  return async function handler(req: Request): Promise<Response> {
    const origin = req.headers.get("origin"),
      cors: Record<string, string> = {
        "Access-Control-Allow-Headers":
          "authorization, apikey, content-type, x-client-info",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        Vary: "Origin",
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
      };
    if (origin && origins.has(origin))
      cors["Access-Control-Allow-Origin"] = origin;
    const json = (value: unknown, status = 200) =>
      Response.json(value, { status, headers: cors });
    const url = new URL(req.url);
    if (req.method === "GET" && url.pathname.endsWith("/callback")) {
      let ticket: string | undefined;
      let returnTo = validReturns[0],
        result = "error";
      try {
        if (!configured || !returnTo)
          return new Response("GitHub connection is not configured.", {
            status: 503,
            headers: cors,
          });
        const rawState = url.searchParams.get("state") || "";
        if (!/^[A-Za-z0-9_-]{43}$/.test(rawState))
          fail("oauth_state_invalid", "인증 요청을 다시 시작해주세요.");
        const pending = await store.consumeState(
          await hashState(rawState),
          now().toISOString(),
        );
        if (!pending || !(await store.activeUser(pending.user_id)))
          fail(
            "oauth_state_invalid",
            "인증 요청이 만료되었거나 취소되었습니다.",
          );
        returnTo = allowedReturnUrl(pending.return_url, validReturns);
        if (url.searchParams.has("error")) result = "denied";
        else {
          const code = string(url.searchParams.get("code"), 512);
          // A callback URL alone cannot attach a GitHub account to a TGS user.
          // The originating browser must complete with that user's current TGS JWT.
          ticket = (await makeOAuthRequest(config.clientId, config.callbackUrl))
            .state;
          const staged = await store.stageOAuth({
            ...pending,
            state_hash: await hashState(ticket),
            code_ciphertext: await encryptToken(
              code,
              config.tokenKey,
              `oauth-code:${pending.user_id}`,
            ),
            expires_at: new Date(now().getTime() + 5 * 60000).toISOString(),
          });
          if (!staged)
            fail(
              "oauth_state_invalid",
              "인증 요청이 취소되었거나 변경되었습니다.",
            );
          result = "pending";
        }
      } catch {
        result = "error";
      }
      if (!returnTo)
        return new Response("GitHub connection is not configured.", {
          status: 503,
          headers: cors,
        });
      return new Response(null, {
        status: 303,
        headers: {
          ...cors,
          Location: callbackTarget(
            returnTo,
            result,
            result === "pending" ? ticket : undefined,
          ),
        },
      });
    }
    if (origin && !origins.has(origin))
      return json(
        {
          error: {
            code: "origin_forbidden",
            message: "허용되지 않는 요청입니다.",
          },
        },
        403,
      );
    if (req.method === "OPTIONS")
      return new Response(null, { status: 204, headers: cors });
    if (req.method !== "POST")
      return json(
        {
          error: {
            code: "method_not_allowed",
            message: "POST 요청만 가능합니다.",
          },
        },
        405,
      );
    try {
      const bearer = req.headers
        .get("authorization")
        ?.match(/^Bearer (.+)$/i)?.[1];
      if (!bearer) fail("unauthorized", "TGS Tracker에 로그인해주세요.", 401);
      const actor = await deps.authenticate(bearer);
      const recheck = async (customerId: string, admin = false) => {
        const current = await deps.authenticate(bearer);
        if (current.id !== actor.id)
          fail(
            "unauthorized",
            "계정이 변경되었습니다. 다시 조회해주세요.",
            401,
          );
        customer(current, customerId);
        if (admin && !current.admin)
          fail("customer_forbidden", "관리자 권한이 필요합니다.", 403);
      };
      const raw = await req.text();
      if (raw.length > 8192) fail("invalid_input", "요청이 너무 큽니다.");
      let body: Record<string, unknown>;
      try {
        body = JSON.parse(raw);
        if (!body || typeof body !== "object" || Array.isArray(body))
          throw new Error();
      } catch {
        return json(
          {
            error: {
              code: "invalid_input",
              message: "요청 형식을 확인해주세요.",
            },
          },
          400,
        );
      }
      const action = body.action;
      if (action === "status") {
        const c = await store.getConnection(actor.id);
        const expired =
          !!c?.expires_at && Date.parse(c.expires_at) <= now().getTime();
        return json({
          configured,
          connected: configured && !!c?.token_ciphertext && !expired,
          ...(c?.token_ciphertext
            ? {
                login: c.login,
                expiresAt: c.expires_at,
                connectedAt: c.connected_at,
              }
            : {}),
          reason: !configured
            ? "not_configured"
            : expired
              ? "expired"
              : !c?.token_ciphertext
                ? "disconnected"
                : undefined,
        });
      }
      if (!configured)
        fail(
          "not_configured",
          "관리자가 GitHub 앱과 서버 연결 설정을 완료해야 합니다.",
          503,
        );
      if (action === "connect") {
        const returnUrl = allowedReturnUrl(body.returnUrl, validReturns);
        const oauth = await makeOAuthRequest(
          config.clientId,
          config.callbackUrl,
        );
        await store.beginOAuth({
          state_hash: await hashState(oauth.state),
          user_id: actor.id,
          generation: crypto.randomUUID(),
          code_verifier: oauth.verifier,
          return_url: returnUrl,
          expires_at: new Date(now().getTime() + 10 * 60000).toISOString(),
        });
        return json({ url: oauth.url });
      }
      if (action === "complete") {
        const ticket = string(body.ticket, 43);
        if (!/^[A-Za-z0-9_-]{43}$/.test(ticket))
          fail("oauth_state_invalid", "인증 요청을 다시 시작해주세요.");
        const pending = await store.consumeState(
          await hashState(ticket),
          now().toISOString(),
          actor.id,
        );
        if (!pending)
          fail(
            "oauth_state_invalid",
            "인증 요청이 만료되었거나 다른 계정의 요청입니다.",
          );
        await completeOAuth(pending);
        return json({ ok: true });
      }
      if (action === "disconnect") {
        const old = await store.getConnection(actor.id);
        await store.endConnection(actor.id);
        let revoked = !old?.token_ciphertext;
        if (old?.token_ciphertext)
          try {
            const token = await decryptToken(
              old.token_ciphertext,
              config.tokenKey,
              actor.id,
            );
            const response = await fetchImpl(
              `https://api.github.com/applications/${encodeURIComponent(config.clientId)}/token`,
              {
                method: "DELETE",
                redirect: "error",
                signal: AbortSignal.timeout(10000),
                headers: {
                  Authorization: `Basic ${btoa(`${config.clientId}:${config.clientSecret}`)}`,
                  Accept: "application/vnd.github+json",
                  "Content-Type": "application/json",
                  "User-Agent": "TGS-Tracker",
                },
                body: JSON.stringify({ access_token: token }),
              },
            );
            revoked = response.ok || response.status === 404;
          } catch {
            revoked = false;
          }
        return json({ ok: true, revoked });
      }
      const { github } = await api(actor);
      if (action === "accessibleRepositories")
        return json(await github.listRepositories(Number(body.page || 1)));
      if (action === "repositories") {
        const id = uuid(body.customerId);
        customer(actor, id);
        return json({ repositories: await store.listRepositories(id) });
      }
      if (action === "attachRepository") {
        if (!actor.admin)
          fail("customer_forbidden", "저장소 등록은 관리자만 가능합니다.", 403);
        const id = uuid(body.customerId);
        customer(actor, id);
        const repo = await github.getRepository(string(body.fullName, 200));
        await recheck(id, true);
        return json({
          repository: await store.attachRepository(id, repo, actor.id),
        });
      }
      const repo = await repository(actor, body.repositoryId);
      // 매 요청마다 현재 GitHub 계정의 저장소 접근 권한과 저장소 ID를 확인한다.
      const accessible = await github.getRepository(repo.fullName);
      if (accessible.githubId !== repo.githubId)
        fail(
          "github_missing",
          "저장소가 이전되거나 변경되었습니다. 관리자가 연결을 확인해야 합니다.",
          404,
        );
      if (action === "detachRepository") {
        if (!actor.admin)
          fail(
            "customer_forbidden",
            "저장소 연결 해제는 관리자만 가능합니다.",
            403,
          );
        await recheck(repo.customerId, true);
        await store.detachRepository(repo.id);
        return json({ ok: true });
      }
      if (action === "branches")
        return json(
          await github.listBranches(repo.fullName, Number(body.page || 1)),
        );
      if (action === "commit")
        return json(await github.getCommit(repo.fullName, sha(body.sha)));
      const { base, target } = branches(body);
      if (action === "compare") {
        const days = Number(body.days);
        if (![7, 30, 90].includes(days))
          fail("invalid_input", "조회 기간을 확인해주세요.");
        return json(
          await github.compare(repo, base, target, days, (sourceShas) =>
            store.listLinks(repo.id, base, target, sourceShas),
          ),
        );
      }
      if (action === "saveLink") {
        const sourceSha = sha(body.sourceSha, true),
          targetSha = sha(body.targetSha, true);
        const [baseHead, targetHead] = await Promise.all([
          github.getBranch(repo.fullName, base),
          github.getBranch(repo.fullName, target),
        ]);
        const [sourcePresent, targetPresent] = await Promise.all([
          github.isAncestor(repo.fullName, sourceSha, baseHead.sha),
          github.isAncestor(repo.fullName, targetSha, targetHead.sha),
        ]);
        if (!sourcePresent || !targetPresent)
          fail(
            "invalid_input",
            "선택한 커밋이 해당 브랜치에 포함되어 있지 않습니다.",
          );
        await recheck(repo.customerId);
        const link = {
          sourceSha,
          targetSha,
          baseBranch: base,
          targetBranch: target,
          confirmedBy: actor.id,
          confirmedAt: now().toISOString(),
        };
        await store.saveLink(repo.id, link);
        return json({ link });
      }
      if (action === "deleteLink") {
        await recheck(repo.customerId);
        await store.deleteLink(
          repo.id,
          base,
          target,
          sha(body.sourceSha, true),
        );
        return json({ ok: true });
      }
      fail("invalid_input", "지원하지 않는 GitHub 작업입니다.");
    } catch (error) {
      if (error instanceof GitHubError)
        return json(
          { error: { code: error.code, message: error.message } },
          error.status,
        );
      return json(
        {
          error: {
            code: "github_unavailable",
            message:
              "GitHub 연결을 처리하지 못했습니다. 설정 또는 연결 상태를 확인하고 다시 시도해주세요.",
          },
        },
        503,
      );
    }
  };
}
