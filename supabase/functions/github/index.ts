import { createClient } from "npm:@supabase/supabase-js@2";
import { createGitHubHandler } from "./handler.ts";
import type { GitHubStore, StoredConnection, StoredState } from "./handler.ts";
import type { GitHubRepository, ManualLink } from "./contracts.ts";
import { GitHubError } from "./core.ts";

const service = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
function checked<T>(result: { data: T; error: unknown }): T {
  if (result.error)
    throw new GitHubError(
      "github_unavailable",
      "GitHub 연결 데이터 설정을 확인해주세요.",
      503,
    );
  return result.data;
}
type RepoRow = {
  id: string;
  customer_id: string;
  github_id: number;
  full_name: string;
  default_branch: string;
};
const repoDTO = (row: RepoRow): GitHubRepository => ({
  id: row.id,
  customerId: row.customer_id,
  githubId: row.github_id,
  fullName: row.full_name,
  defaultBranch: row.default_branch,
});
type LinkRow = {
  source_sha: string;
  target_sha: string;
  base_branch: string;
  target_branch: string;
  confirmed_by: string;
  confirmed_at: string;
};
const linkDTO = (row: LinkRow): ManualLink => ({
  sourceSha: row.source_sha,
  targetSha: row.target_sha,
  baseBranch: row.base_branch,
  targetBranch: row.target_branch,
  confirmedBy: row.confirmed_by,
  confirmedAt: row.confirmed_at,
});
const store: GitHubStore = {
  async getConnection(userId) {
    return checked(
      await service
        .from("github_connections")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle(),
    ) as StoredConnection | null;
  },
  async beginOAuth(state) {
    checked(
      await service.rpc("github_begin_oauth", {
        uid: state.user_id,
        gen: state.generation,
        hash: state.state_hash,
        verifier: state.code_verifier,
        return_to: state.return_url,
        expires: state.expires_at,
      }),
    );
  },
  async consumeState(hash, now, userId) {
    let query = service
      .from("github_oauth_states")
      .delete()
      .eq("state_hash", hash)
      .gt("expires_at", now);
    query = userId
      ? query.eq("user_id", userId).not("code_ciphertext", "is", null)
      : query.is("code_ciphertext", null);
    const rows = checked(await query.select("*")) as StoredState[];
    return rows[0] || null;
  },
  async stageOAuth(state) {
    return (
      checked(
        await service.rpc("github_stage_oauth", {
          uid: state.user_id,
          gen: state.generation,
          hash: state.state_hash,
          verifier: state.code_verifier,
          return_to: state.return_url,
          expires: state.expires_at,
          code: state.code_ciphertext,
        }),
      ) === true
    );
  },
  async saveConnection(connection) {
    const { user_id, generation, ...data } = connection;
    const rows = checked(
      await service
        .from("github_connections")
        .update(data)
        .eq("user_id", user_id)
        .eq("generation", generation)
        .select("user_id"),
    );
    return rows?.length === 1;
  },
  async endConnection(userId) {
    checked(await service.rpc("github_end_connection", { uid: userId }));
  },
  async activeUser(userId) {
    const row = checked(
      await service
        .from("profiles")
        .select("id")
        .eq("id", userId)
        .eq("is_active", true)
        .maybeSingle(),
    );
    return !!row;
  },
  async listRepositories(customerId) {
    return (
      checked(
        await service
          .from("github_repositories")
          .select("*")
          .eq("customer_id", customerId)
          .eq("is_active", true)
          .order("full_name"),
      ) as RepoRow[]
    ).map(repoDTO);
  },
  async getRepository(id) {
    const row = checked(
      await service
        .from("github_repositories")
        .select("*")
        .eq("id", id)
        .eq("is_active", true)
        .maybeSingle(),
    ) as RepoRow | null;
    return row ? repoDTO(row) : null;
  },
  async attachRepository(customerId, repo, actorId) {
    const row = checked(
      await service
        .from("github_repositories")
        .upsert(
          {
            customer_id: customerId,
            github_id: repo.githubId,
            full_name: repo.fullName,
            default_branch: repo.defaultBranch,
            created_by: actorId,
            is_active: true,
          },
          { onConflict: "customer_id,github_id" },
        )
        .select("*")
        .single(),
    ) as RepoRow;
    return repoDTO(row);
  },
  async detachRepository(id) {
    checked(
      await service
        .from("github_repositories")
        .update({ is_active: false })
        .eq("id", id),
    );
  },
  async listLinks(repositoryId, base, target, sourceShas) {
    const links: ManualLink[] = [];
    // Only current source commits matter. Batches avoid both URL length and PostgREST row caps.
    for (let start = 0; start < sourceShas.length; start += 100) {
      const hashes = sourceShas.slice(start, start + 100);
      let offset = 0,
        total = 0;
      do {
        const response = await service
          .from("github_commit_links")
          .select("*", { count: "exact" })
          .eq("repository_id", repositoryId)
          .eq("base_branch", base)
          .eq("target_branch", target)
          .in("source_sha", hashes)
          .order("source_sha")
          .range(offset, offset + 99);
        const rows = checked(response) as LinkRow[];
        total = response.count || 0;
        if (!rows.length && offset < total)
          throw new GitHubError(
            "github_unavailable",
            "수동 대응 기록을 완전히 조회하지 못했습니다. 다시 시도해주세요.",
            503,
          );
        links.push(...rows.map(linkDTO));
        offset += rows.length;
      } while (offset < total);
    }
    return links;
  },
  async saveLink(repositoryId, link) {
    checked(
      await service.from("github_commit_links").upsert(
        {
          repository_id: repositoryId,
          source_sha: link.sourceSha,
          target_sha: link.targetSha,
          base_branch: link.baseBranch,
          target_branch: link.targetBranch,
          confirmed_by: link.confirmedBy,
          confirmed_at: link.confirmedAt,
        },
        { onConflict: "repository_id,base_branch,target_branch,source_sha" },
      ),
    );
  },
  async deleteLink(repositoryId, base, target, sourceSha) {
    checked(
      await service
        .from("github_commit_links")
        .delete()
        .eq("repository_id", repositoryId)
        .eq("base_branch", base)
        .eq("target_branch", target)
        .eq("source_sha", sourceSha),
    );
  },
};
const appUrl = Deno.env.get("APP_URL") || "";
const returnUrls = (Deno.env.get("GITHUB_RETURN_URLS") || appUrl)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
Deno.serve(
  createGitHubHandler({
    store,
    config: {
      appUrl,
      returnUrls,
      clientId: Deno.env.get("GITHUB_CLIENT_ID") || "",
      clientSecret: Deno.env.get("GITHUB_CLIENT_SECRET") || "",
      tokenKey: Deno.env.get("GITHUB_TOKEN_KEY") || "",
      callbackUrl:
        Deno.env.get("GITHUB_CALLBACK_URL") ||
        `${Deno.env.get("SUPABASE_URL")}/functions/v1/github/callback`,
    },
    async authenticate(token) {
      const { data, error } = await service.auth.getUser(token);
      if (error || !data.user)
        throw new GitHubError(
          "unauthorized",
          "TGS Tracker에 다시 로그인해주세요.",
          401,
        );
      const profile = checked(
        await service
          .from("profiles")
          .select("role,is_active")
          .eq("id", data.user.id)
          .single(),
      );
      if (!profile?.is_active)
        throw new GitHubError(
          "account_inactive",
          "계정 접근이 제한되었습니다.",
          403,
        );
      const admin = profile.role === "admin";
      const customers = checked(
        await service.from("customers").select("id").eq("is_active", true),
      ) as { id: string }[];
      let customerIds = customers.map((c) => c.id);
      if (!admin) {
        const memberships = checked(
          await service
            .from("customer_members")
            .select("customer_id")
            .eq("user_id", data.user.id),
        ) as { customer_id: string }[];
        const memberIds = new Set(memberships.map((m) => m.customer_id));
        customerIds = customerIds.filter((id) => memberIds.has(id));
      }
      return { id: data.user.id, admin, customerIds };
    },
  }),
);
