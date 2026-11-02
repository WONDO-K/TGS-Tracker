import { client } from "./supabase";
export type {
  GitHubConnection,
  GitHubRepository,
  AccessibleRepository,
  GitHubBranch,
  CommitDetail,
  Comparison,
  ComparedCommit,
  ManualLink,
} from "../../supabase/functions/github/contracts";
export class GitHubError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export async function github<T>(
  action: string,
  body: Record<string, unknown> = {},
  expectedActorId?: string,
): Promise<T> {
  const api = client();
  const {
    data: { session },
    error: sessionError,
  } = await api.auth.getSession();
  if (
    sessionError ||
    !session ||
    (expectedActorId && session.user.id !== expectedActorId)
  )
    throw new GitHubError(
      "unauthorized",
      "로그인 계정이 변경되었거나 만료되었습니다. 현재 계정으로 다시 조회해주세요.",
    );
  const { data, error } = await api.functions.invoke("github", {
    headers: { Authorization: `Bearer ${session.access_token}` },
    body: { action, ...body },
  });
  if (error) {
    let failure;
    try {
      failure = await error.context?.json();
    } catch {
      /* Network failures have no JSON response. */
    }
    throw new GitHubError(
      failure?.error?.code || "network_error",
      failure?.error?.message ||
        "GitHub 조회에 실패했습니다. 잠시 후 다시 시도해주세요.",
    );
  }
  if (data?.error) throw new GitHubError(data.error.code, data.error.message);
  return data as T;
}
export function githubUrl(value: string | undefined): string | undefined {
  try {
    const url = new URL(value || "");
    return url.protocol === "https:" &&
      url.hostname === "github.com" &&
      !url.username &&
      !url.password &&
      !url.port
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}
