import { useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "../../app/Session";
import { Alert, PageTitle } from "../../components/UI";
import { useConfirm } from "../../components/Confirm";
import { callbackUrl } from "../../lib/supabase";
import { formatDate } from "../../lib/domain";
import { github, GitHubError, githubUrl } from "../../lib/github";
import type {
  GitHubConnection,
  GitHubRepository,
  AccessibleRepository,
  GitHubBranch,
  Comparison,
  CommitDetail,
  ManualLink,
  ComparedCommit,
} from "../../lib/github";
import { CommitPreview } from "./CommitPreview";
import { resultLabels } from "./preview";
import "./commits.css";

type Draft = {
  repositoryId: string;
  baseBranch: string;
  targetBranch: string;
  days: number;
};
const emptyDraft: Draft = {
  repositoryId: "",
  baseBranch: "",
  targetBranch: "",
  days: 30,
};
export function LiveCommitCompare() {
  const { profile, customers: assignedCustomers } = useSession();
  const customers = useMemo(
    () => assignedCustomers.filter((c) => c.is_active),
    [assignedCustomers],
  );
  const [connection, setConnection] = useState<GitHubConnection | null>(null);
  const [customer, setCustomer] = useState(customers[0]?.id || "");
  const [repositories, setRepositories] = useState<GitHubRepository[]>([]);
  const [branches, setBranches] = useState<GitHubBranch[]>([]);
  const [branchRevision, setBranchRevision] = useState(0);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<CommitDetail | null>(null);
  const [candidate, setCandidate] = useState("");
  const [verified, setVerified] = useState<CommitDetail | null>(null);
  const [confirmation, setConfirmation] = useState<ManualLink | null>(null);
  const [tab, setTab] = useState<"evidence" | "files">("evidence");
  const [filter, setFilter] = useState("all"),
    [search, setSearch] = useState("");
  const [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false),
    [loadingRepos, setLoadingRepos] = useState(false),
    [loadingBranches, setLoadingBranches] = useState(false),
    [detailBusy, setDetailBusy] = useState(false);
  const [blocked, setBlocked] = useState(false),
    [preview, setPreview] = useState(false);
  const [accessible, setAccessible] = useState<AccessibleRepository[]>([]),
    [accessPage, setAccessPage] = useState(0),
    [hasMore, setHasMore] = useState(false),
    [fullName, setFullName] = useState("");
  const generation = useRef(0),
    sequence = useRef(0),
    detailSequence = useRef(0),
    candidateSequence = useRef(0);
  const trigger = useRef<HTMLButtonElement | null>(null),
    heading = useRef<HTMLHeadingElement>(null),
    searchInput = useRef<HTMLInputElement>(null);
  const confirm = useConfirm();
  // Each render's closures retain their actor, even across confirmation or network awaits.
  function request<T>(action: string, body: Record<string, unknown> = {}) {
    return github<T>(action, body, profile?.id);
  }
  // React StrictMode replays effects; keep the callback and one completion request in memory.
  const callbackParams = useRef(
    new URLSearchParams(window.location.hash.split("?")[1]),
  );
  const completion = useRef<{
    actor: string;
    request: Promise<unknown>;
  } | null>(null);
  const active = Boolean(profile?.is_active);
  const current = comparison?.rows.find((c) => c.sha === selected);
  const mappedRepo = repositories.find(
    (r) => r.id === comparison?.repositoryId,
  );
  function clearPrivate() {
    setComparison(null);
    setSelected(null);
    setDetail(null);
    setVerified(null);
    setConfirmation(null);
    setAccessible([]);
    setAccessPage(0);
    setFullName("");
    detailSequence.current++;
    candidateSequence.current++;
  }
  function fail(e: unknown) {
    const code = e instanceof GitHubError ? e.code.toLowerCase() : "";
    if (
      /expired|unauthor|forbidden|denied|disconnect|not_connected|session|inactive|github_permission|github_missing/.test(
        code,
      )
    ) {
      generation.current++;
      clearPrivate();
      setRepositories([]);
      setBranches([]);
      setBlocked(true);
      setBusy(false);
      setLoadingRepos(false);
      setLoadingBranches(false);
      if (/expired|disconnect|not_connected/.test(code))
        setConnection((c) => c && { ...c, connected: false });
    }
    setError(
      e instanceof Error
        ? e.message
        : "조회에 실패했습니다. 다시 시도해주세요.",
    );
  }
  async function status() {
    const g = generation.current;
    setError("");
    try {
      const value = await request<GitHubConnection>("status");
      if (g !== generation.current) return;
      setConnection(value);
      setBlocked(false);
      if (!value.connected) clearPrivate();
      return value;
    } catch (e) {
      if (g === generation.current) fail(e);
    }
  }
  useEffect(() => {
    generation.current++;
    clearPrivate();
    setConnection(null);
    setRepositories([]);
    setBranches([]);
    const params = new URLSearchParams(window.location.hash.split("?")[1]);
    const callback = callbackParams.current.get("github");
    const ticket = callbackParams.current.get("ticket");
    const g = generation.current;
    if (callback) {
      setNotice(
        callback === "connected"
          ? "GitHub 연결을 확인하고 있습니다."
          : callback === "denied"
            ? "GitHub 연결 승인이 취소되었습니다. 다시 연결할 수 있습니다."
            : "GitHub 연결을 완료하지 못했습니다. 다시 시도해주세요.",
      );
      params.delete("github");
      params.delete("ticket");
      const hash = window.location.hash.split("?")[0];
      window.history.replaceState(
        null,
        "",
        window.location.pathname +
          window.location.search +
          hash +
          (params.size ? "?" + params.toString() : ""),
      );
    }
    if (active)
      void (async () => {
        if (callback === "pending") {
          setNotice("GitHub 연결 승인을 확인하고 있습니다.");
          try {
            if (!ticket || !/^[A-Za-z0-9_-]{43}$/.test(ticket))
              throw new Error(
                "GitHub 연결 승인 정보가 유효하지 않습니다. 다시 연결해주세요.",
              );
            if (completion.current && completion.current.actor !== profile!.id)
              throw new Error("연결을 시작한 계정으로 다시 로그인해주세요.");
            completion.current ??= {
              actor: profile!.id,
              request: request("complete", { ticket }),
            };
            await completion.current.request;
            if (g !== generation.current) return;
            const value = await status();
            if (g === generation.current && value?.connected)
              setNotice("GitHub 연결을 완료했습니다.");
          } catch (e) {
            if (g === generation.current) {
              setNotice(
                "GitHub 연결을 완료하지 못했습니다. 다시 연결해주세요.",
              );
              fail(e);
              if (g === generation.current) await status();
            }
          }
        } else await status();
      })();
    return () => {
      generation.current++;
      detailSequence.current++;
      candidateSequence.current++;
    };
  }, [profile?.id, active]);
  useEffect(() => {
    if (!customers.some((c) => c.id === customer))
      setCustomer(customers[0]?.id || "");
  }, [customers, customer]);
  async function loadRepositories() {
    const g = generation.current;
    setLoadingRepos(true);
    try {
      const value = await request<{ repositories: GitHubRepository[] }>(
        "repositories",
        { customerId: customer },
      );
      if (g !== generation.current) return;
      setRepositories(value.repositories);
      setBranchRevision((value) => value + 1);
      setDraft((d) =>
        value.repositories.some((r) => r.id === d.repositoryId)
          ? d
          : {
              ...emptyDraft,
              days: d.days,
              repositoryId: value.repositories[0]?.id || "",
            },
      );
    } catch (e) {
      if (g === generation.current) fail(e);
    } finally {
      if (g === generation.current) setLoadingRepos(false);
    }
  }
  useEffect(() => {
    if (!connection?.connected) return;
    generation.current++;
    clearPrivate();
    setRepositories([]);
    setBranches([]);
    setDraft(emptyDraft);
    setError("");
    setBlocked(false);
    setLoadingRepos(false);
    setLoadingBranches(false);
    setBusy(false);
    if (active && connection?.connected && customer) void loadRepositories();
  }, [customer, connection, profile?.id]);
  useEffect(() => {
    let cancelled = false;
    const g = generation.current;
    setBranches([]);
    if (!draft.repositoryId || blocked) return;
    setLoadingBranches(true);
    void (async () => {
      try {
        const all: GitHubBranch[] = [];
        let more = true;
        for (let page = 1; more; page++) {
          const value = await request<{
            branches: GitHubBranch[];
            hasMore: boolean;
          }>("branches", { repositoryId: draft.repositoryId, page });
          if (cancelled || g !== generation.current) return;
          all.push(...value.branches);
          more = value.hasMore;
        }
        setBranches(all);
        const defaultBranch = repositories.find(
          (r) => r.id === draft.repositoryId,
        )?.defaultBranch;
        setDraft((d) => ({
          ...d,
          baseBranch: all.some((b) => b.name === d.baseBranch)
            ? d.baseBranch
            : all.find((b) => b.name !== defaultBranch)?.name ||
              all[0]?.name ||
              "",
          targetBranch: all.some((b) => b.name === d.targetBranch)
            ? d.targetBranch
            : defaultBranch && all.some((b) => b.name === defaultBranch)
              ? defaultBranch
              : all[1]?.name || all[0]?.name || "",
        }));
      } catch (e) {
        if (!cancelled && g === generation.current) fail(e);
      } finally {
        if (!cancelled && g === generation.current) setLoadingBranches(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [draft.repositoryId, blocked, branchRevision]);
  function closeDetail() {
    detailSequence.current++;
    candidateSequence.current++;
    setBusy(false);
    setSelected(null);
    setDetail(null);
    setVerified(null);
    requestAnimationFrame(() => {
      if (trigger.current?.isConnected) trigger.current.focus();
      else searchInput.current?.focus();
    });
  }
  useEffect(() => {
    if (selected) heading.current?.focus();
  }, [selected]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        selected &&
        e.key === "Escape" &&
        !document.querySelector("dialog[open]")
      )
        closeDetail();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selected]);
  async function connect() {
    const g = generation.current;
    setBusy(true);
    setError("");
    try {
      const { url } = await request<{ url: string }>("connect", {
        returnUrl: callbackUrl(),
      });
      if (g !== generation.current) return;
      const safe = githubUrl(url);
      if (!safe || new URL(safe).pathname !== "/login/oauth/authorize")
        throw new Error(
          "안전한 GitHub 인증 주소를 받지 못했습니다. 다시 시도해주세요.",
        );
      window.location.assign(safe);
    } catch (e) {
      if (g === generation.current) fail(e);
    } finally {
      if (g === generation.current) setBusy(false);
    }
  }
  async function disconnect() {
    const scopeGeneration = generation.current;
    if (
      !(await confirm({
        title: "GitHub 연결을 해제할까요?",
        message: "이 계정의 연결을 해제합니다. 저장된 대응 기록은 유지됩니다.",
        action: "해제",
      }))
    )
      return;
    if (scopeGeneration !== generation.current) return;
    generation.current++;
    clearPrivate();
    setRepositories([]);
    setBranches([]);
    setBlocked(true);
    setBusy(false);
    setLoadingRepos(false);
    setLoadingBranches(false);
    setBusy(true);
    const g = generation.current;
    try {
      await request("disconnect");
      if (g === generation.current) {
        setConnection((c) => c && { ...c, connected: false });
        setBlocked(false);
        setNotice("GitHub 연결을 해제했습니다.");
      }
    } catch (e) {
      if (g === generation.current) fail(e);
    } finally {
      if (g === generation.current) setBusy(false);
    }
  }
  async function compare(conditions = draft) {
    if (conditions.baseBranch === conditions.targetBranch) {
      setError("기준과 비교 대상은 서로 다른 브랜치를 선택해주세요.");
      return;
    }
    const g = generation.current,
      s = ++sequence.current;
    setBusy(true);
    setError("");
    try {
      const value = await request<Comparison>("compare", conditions);
      if (g !== generation.current || s !== sequence.current) return;
      setComparison(value);
      closeDetail();
      setFilter("all");
      setSearch("");
    } catch (e) {
      if (g === generation.current && s === sequence.current) fail(e);
    } finally {
      if (g === generation.current && s === sequence.current) setBusy(false);
    }
  }
  async function openDetail(row: ComparedCommit, button: HTMLButtonElement) {
    const g = generation.current,
      s = ++detailSequence.current;
    candidateSequence.current++;
    setBusy(false);
    trigger.current = button;
    setSelected(row.sha);
    setTab("evidence");
    setDetail(null);
    setCandidate("");
    setVerified(null);
    setConfirmation(null);
    setDetailBusy(true);
    try {
      const value = await request<CommitDetail>("commit", {
        repositoryId: comparison!.repositoryId,
        sha: row.sha,
      });
      if (g === generation.current && s === detailSequence.current)
        setDetail(value);
    } catch (e) {
      if (g === generation.current && s === detailSequence.current) fail(e);
    } finally {
      if (g === generation.current && s === detailSequence.current)
        setDetailBusy(false);
    }
  }
  async function verify() {
    const g = generation.current,
      s = ++candidateSequence.current;
    setVerified(null);
    setError("");
    if (!/^[a-f0-9]{7,40}$/i.test(candidate.trim())) {
      setError("7–40자리의 커밋 SHA를 입력해주세요.");
      return;
    }
    setBusy(true);
    try {
      const value = await request<CommitDetail>("commit", {
        repositoryId: comparison!.repositoryId,
        sha: candidate.trim(),
      });
      if (g === generation.current && s === candidateSequence.current)
        setVerified(value);
    } catch (e) {
      if (g === generation.current && s === candidateSequence.current) fail(e);
    } finally {
      if (g === generation.current && s === candidateSequence.current)
        setBusy(false);
    }
  }
  async function save(remove = false) {
    if (!comparison || !current || (!remove && !verified)) return;
    const g = generation.current,
      d = detailSequence.current;
    if (
      !(await confirm({
        title: remove ? "수동 대응을 해제할까요?" : "대응 커밋을 저장할까요?",
        message:
          "저장소 내용은 변경하지 않습니다. 이 브랜치 조합의 수동 대응 기록만 변경합니다.",
        action: remove ? "해제" : "저장",
      }))
    )
      return;
    if (g !== generation.current || d !== detailSequence.current) return;
    const sha = current.sha;
    setBusy(true);
    setError("");
    const scope = {
      repositoryId: comparison.repositoryId,
      baseBranch: comparison.baseBranch,
      targetBranch: comparison.targetBranch,
      sourceSha: sha,
    };
    try {
      const result = remove
        ? await request<{ ok: true }>("deleteLink", scope)
        : await request<{ link: ManualLink }>("saveLink", {
            ...scope,
            targetSha: verified!.sha,
          });
      if (g !== generation.current || d !== detailSequence.current) return;
      if ("link" in result) {
        setConfirmation(result.link);
        setComparison(
          (old) =>
            old && {
              ...old,
              rows: old.rows.map((r) =>
                r.sha === sha
                  ? {
                      ...r,
                      result: "matched",
                      target: result.link.targetSha,
                      evidence: "수동 연결",
                    }
                  : r,
              ),
            },
        );
        setNotice("수동 대응을 저장했습니다.");
      } else {
        setConfirmation(null);
        await compare({
          repositoryId: comparison.repositoryId,
          baseBranch: comparison.baseBranch,
          targetBranch: comparison.targetBranch,
          days: Math.max(
            1,
            Math.round(
              (Date.parse(comparison.comparedAt) -
                Date.parse(comparison.since)) /
                86400000,
            ),
          ),
        });
        setNotice("수동 대응을 해제했습니다.");
      }
    } catch (e) {
      if (g === generation.current && d === detailSequence.current) fail(e);
    } finally {
      if (g === generation.current) setBusy(false);
    }
  }
  async function accessiblePage(page: number) {
    const g = generation.current;
    setBusy(true);
    setError("");
    try {
      const value = await request<{
        repositories: AccessibleRepository[];
        hasMore: boolean;
      }>("accessibleRepositories", { page });
      if (g === generation.current) {
        setAccessible((old) =>
          page === 1 ? value.repositories : [...old, ...value.repositories],
        );
        setAccessPage(page);
        setHasMore(value.hasMore);
      }
    } catch (e) {
      if (g === generation.current) fail(e);
    } finally {
      if (g === generation.current) setBusy(false);
    }
  }
  async function mapping(detach = false) {
    const g = generation.current;
    if (
      detach &&
      !(await confirm({
        title: "저장소 등록을 해제할까요?",
        message: "고객사 매핑을 비활성화하고 기존 대응 기록은 보존합니다.",
        action: "등록 해제",
      }))
    )
      return;
    if (g !== generation.current) return;
    setBusy(true);
    setError("");
    try {
      await request(
        detach ? "detachRepository" : "attachRepository",
        detach
          ? { repositoryId: draft.repositoryId }
          : { customerId: customer, fullName },
      );
      if (g !== generation.current) return;
      generation.current++;
      clearPrivate();
      await loadRepositories();
      setNotice(
        detach
          ? "저장소 등록을 해제했습니다. 기존 기록은 보존됩니다."
          : "고객사 저장소를 등록했습니다.",
      );
    } catch (e) {
      if (g === generation.current) fail(e);
    } finally {
      setBusy(false);
    }
  }
  if (preview)
    return (
      <>
        <button className="quiet" onClick={() => setPreview(false)}>
          실제 GitHub 연결 화면으로
        </button>
        <CommitPreview ready />
      </>
    );
  const gated = !active || !connection?.connected || blocked;
  const shown =
    comparison?.rows.filter(
      (r) =>
        (filter === "all" || filter === r.result) &&
        `${r.title} ${r.sha} ${r.author} ${r.target || ""}`
          .toLowerCase()
          .includes(search.trim().toLowerCase()),
    ) || [];
  const changed =
    comparison &&
    (draft.repositoryId !== comparison.repositoryId ||
      draft.baseBranch !== comparison.baseBranch ||
      draft.targetBranch !== comparison.targetBranch ||
      Math.abs(
        (Date.parse(comparison.comparedAt) - Date.parse(comparison.since)) /
          86400000 -
          draft.days,
      ) > 0.1);
  const originalUrl = githubUrl(detail?.url);
  return (
    <div className={`commit-workspace ${current ? "has-detail" : ""}`}>
      <PageTitle
        title="커밋 대조"
        eyebrow=""
        description="브랜치 사이에 옮긴 변경과 아직 확인하지 못한 변경을 대조합니다."
        action={
          connection?.connected && (
            <details className="commit-connection">
              <summary>GitHub · {connection.login}</summary>
              <div>
                <p>사용자별 GitHub 연결입니다.</p>
                <button
                  className="quiet"
                  disabled={busy}
                  onClick={() => void disconnect()}
                >
                  GitHub 연결 해제
                </button>
              </div>
            </details>
          )
        }
      />
      {error && (
        <Alert>
          {error} {comparison && !gated && "이전 대조 결과를 유지합니다."}
          <button
            className="text-button"
            disabled={busy}
            onClick={() =>
              void (gated
                ? status()
                : comparison
                  ? compare({
                      repositoryId: comparison.repositoryId,
                      baseBranch: comparison.baseBranch,
                      targetBranch: comparison.targetBranch,
                      days: Math.round(
                        (Date.parse(comparison.comparedAt) -
                          Date.parse(comparison.since)) /
                          86400000,
                      ),
                    })
                  : loadRepositories())
            }
          >
            다시 조회
          </button>
        </Alert>
      )}
      {notice && <Alert tone="info">{notice}</Alert>}
      {gated ? (
        <section className="commit-gate">
          <h2>
            {!connection
              ? error
                ? "GitHub 연결을 확인하지 못했습니다"
                : "GitHub 연결 확인 중"
              : blocked
                ? "GitHub 접근 권한을 확인해주세요"
                : connection.reason === "expired"
                  ? "GitHub 재연결이 필요합니다"
                  : "GitHub 연결부터 시작하세요"}
          </h2>
          <p>
            비공개 저장소를 조회하려면 GitHub의 repo 권한 승인이 필요합니다. 이
            권한은 쓰기 권한도 포함하지만 이 앱은 GitHub 저장소 조회만
            수행합니다.
          </p>
          {(connection?.configured === false || (!connection && !!error)) && (
            <p>
              GitHub 연동 설정이 아직 완료되지 않았습니다. 관리자는 저장소의
              docs/github-setup.md 설정 가이드를 확인해주세요.
            </p>
          )}
          <button
            className="primary"
            disabled={!active || !connection?.configured || busy}
            onClick={() => void connect()}
          >
            GitHub 연결
          </button>
          <button className="text-button" onClick={() => setPreview(true)}>
            가상 데이터로 미리보기
          </button>
        </section>
      ) : (
        <>
          <form
            className="commit-conditions"
            onSubmit={(e) => {
              e.preventDefault();
              void compare();
            }}
          >
            <label>
              고객사
              <select
                aria-label="고객사"
                value={customer}
                onChange={(e) => {
                  generation.current++;
                  clearPrivate();
                  setCustomer(e.target.value);
                }}
              >
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              저장소
              <select
                aria-label="저장소"
                value={draft.repositoryId}
                disabled={loadingRepos}
                onChange={(e) => {
                  sequence.current++;
                  setBusy(false);
                  setDraft((d) => ({
                    ...d,
                    repositoryId: e.target.value,
                    baseBranch: "",
                    targetBranch: "",
                  }));
                }}
              >
                {!repositories.length && (
                  <option value="">
                    {loadingRepos ? "불러오는 중" : "등록된 저장소 없음"}
                  </option>
                )}
                {repositories.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.fullName}
                  </option>
                ))}
              </select>
            </label>
            <label>
              기준 브랜치
              <select
                aria-label="기준 브랜치"
                value={draft.baseBranch}
                disabled={loadingBranches}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, baseBranch: e.target.value }))
                }
              >
                {branches.map((b) => (
                  <option key={b.name}>{b.name}</option>
                ))}
              </select>
            </label>
            <label>
              비교 대상 브랜치
              <select
                aria-label="비교 대상 브랜치"
                value={draft.targetBranch}
                disabled={loadingBranches}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, targetBranch: e.target.value }))
                }
              >
                {branches.map((b) => (
                  <option key={b.name}>{b.name}</option>
                ))}
              </select>
            </label>
            <label>
              기준 커밋 기간
              <select
                aria-label="기준 커밋 기간"
                value={draft.days}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, days: Number(e.target.value) }))
                }
              >
                {[7, 30, 90].map((n) => (
                  <option key={n} value={n}>
                    최근 {n}일
                  </option>
                ))}
              </select>
            </label>
            <button
              className="primary"
              disabled={
                busy ||
                loadingBranches ||
                !draft.repositoryId ||
                !draft.baseBranch ||
                !draft.targetBranch
              }
            >
              {busy ? "조회 중…" : "대조하기"}
            </button>
          </form>
          {profile?.role === "admin" ? (
            <details className="commit-mapping">
              <summary>고객사 저장소 관리</summary>
              <p>등록 해제는 매핑을 비활성화하며 대응 기록을 보존합니다.</p>
              <button
                className="quiet"
                disabled={busy}
                onClick={() => void accessiblePage(1)}
              >
                접근 가능한 저장소 조회
              </button>
              {accessPage > 0 && (
                <>
                  <label>
                    등록할 저장소
                    <select
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                    >
                      <option value="">저장소 선택</option>
                      {accessible.map((r) => (
                        <option key={r.githubId} value={r.fullName}>
                          {r.fullName}
                          {r.private ? " · 비공개" : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                  {hasMore && (
                    <button
                      className="quiet"
                      disabled={busy}
                      onClick={() => void accessiblePage(accessPage + 1)}
                    >
                      저장소 더 보기
                    </button>
                  )}
                  <button
                    className="primary"
                    disabled={busy || !fullName || !customer}
                    onClick={() => void mapping()}
                  >
                    고객사에 등록
                  </button>
                </>
              )}
              <button
                className="quiet"
                disabled={busy || !draft.repositoryId}
                onClick={() => void mapping(true)}
              >
                선택 저장소 등록 해제
              </button>
            </details>
          ) : (
            <p className="commit-scope-help">
              고객사에 등록된 저장소만 표시합니다. 저장소 등록·해제는 관리자에게
              요청해주세요.
            </p>
          )}
          {changed && (
            <p className="commit-pending">
              비교 조건이 변경되었습니다. 대조하기를 눌러 적용하세요. 아래
              결과는 이전 조건입니다.
            </p>
          )}
          {busy && comparison && (
            <Alert tone="info">조회 중입니다. 마지막 결과를 유지합니다.</Alert>
          )}
          {comparison ? (
            <>
              <div className="commit-scope">
                <div>
                  <strong>
                    {mappedRepo?.fullName || comparison.repositoryId}
                  </strong>
                  <span>
                    <code>{comparison.baseBranch}</code> 기준 ·{" "}
                    <code>{comparison.targetBranch}</code> 대조
                  </span>
                </div>
                <span>
                  마지막 조회 · {formatDate(comparison.comparedAt, true)}
                </span>
              </div>
              <p className="commit-scope-help">
                기준 커밋: {formatDate(comparison.since, true)} 이후 · 대상
                탐색: 기간 제한 없이 {comparison.targetScanned}건 · 기준 SHA:{" "}
                <code>{comparison.baseSha.slice(0, 7)}</code> /{" "}
                <code>{comparison.targetSha.slice(0, 7)}</code>. 실제 서버
                배포나 되돌리기 이후 유효성을 의미하지 않습니다.
              </p>
              {(!comparison.sourceComplete || !comparison.targetComplete) && (
                <Alert tone="info">
                  조회 한도에 도달한 불완전한 결과입니다. 기준 최대 500건·대상
                  최대 1000건 범위이며 미확인 커밋은 추가 검토가 필요합니다.
                </Alert>
              )}
              <div className="commit-review-layout">
                <section
                  className="commit-results"
                  aria-label="커밋 대조 결과"
                  aria-busy={busy}
                >
                  <div className="commit-result-tools">
                    <div
                      className="commit-filters"
                      role="group"
                      aria-label="대조 결과 필터"
                    >
                      {["all", "unmatched", "review", "matched"].map((f) => (
                        <button
                          key={f}
                          className={filter === f ? "active" : ""}
                          aria-pressed={filter === f}
                          onClick={() => setFilter(f)}
                        >
                          {f === "all"
                            ? "전체"
                            : resultLabels[f as keyof typeof resultLabels]}{" "}
                          <span>
                            {
                              comparison.rows.filter(
                                (r) => f === "all" || r.result === f,
                              ).length
                            }
                          </span>
                        </button>
                      ))}
                    </div>
                    <input
                      ref={searchInput}
                      type="search"
                      aria-label="커밋 검색"
                      placeholder="메시지·SHA·작성자 검색"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </div>
                  {shown.length ? (
                    <div className="commit-table-wrap">
                      <table className="commit-table">
                        <thead>
                          <tr>
                            <th>{comparison.baseBranch} 커밋</th>
                            <th>변경 내용</th>
                            <th>{comparison.targetBranch} 대응</th>
                            <th>대조 결과</th>
                          </tr>
                        </thead>
                        <tbody>
                          {shown.map((c) => (
                            <tr
                              key={c.sha}
                              className={`commit-row ${selected === c.sha ? "selected" : ""}`}
                            >
                              <td data-label="기준 커밋">
                                <code>{c.sha.slice(0, 7)}</code>
                              </td>
                              <td>
                                <button
                                  className="commit-title"
                                  aria-expanded={selected === c.sha}
                                  aria-controls="commit-detail"
                                  onClick={(e) =>
                                    void openDetail(c, e.currentTarget)
                                  }
                                >
                                  {c.title}
                                </button>
                                <div className="commit-byline">
                                  {c.author}
                                  <time dateTime={c.date}>
                                    {formatDate(c.date, true)}
                                  </time>
                                </div>
                              </td>
                              <td data-label="대응 커밋">
                                {c.target ? (
                                  <>
                                    <code>{c.target.slice(0, 7)}</code>
                                    <small>{c.evidence}</small>
                                  </>
                                ) : (
                                  <span className="commit-no-target">
                                    {c.result === "review"
                                      ? "후보 검토 필요"
                                      : "대응 미확인"}
                                  </span>
                                )}
                              </td>
                              <td data-label="대조 결과">
                                <span className={`commit-result ${c.result}`}>
                                  {resultLabels[c.result]}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="commit-empty">
                      <h2>
                        {comparison.rows.length
                          ? "검색 조건에 맞는 커밋이 없습니다"
                          : "조회 범위에 커밋이 없습니다"}
                      </h2>
                      <p>기준 브랜치·기간 또는 검색 조건을 확인해주세요.</p>
                    </div>
                  )}
                  <p className="commit-result-foot">
                    메시지가 유사한 커밋은 자동 확정하지 않습니다. 대응 미확인은
                    조회 범위에서 근거를 찾지 못했다는 뜻입니다.
                  </p>
                </section>
                {current && (
                  <section
                    id="commit-detail"
                    className="commit-detail"
                    role="region"
                    aria-label="커밋 상세"
                  >
                    <div className="commit-detail-top">
                      <button
                        className="text-button commit-back"
                        onClick={closeDetail}
                      >
                        목록으로 돌아가기
                      </button>
                      <button className="quiet" onClick={closeDetail}>
                        닫기
                      </button>
                    </div>
                    <h2 ref={heading} tabIndex={-1}>
                      {current.title}
                    </h2>
                    <div className="commit-detail-id">
                      <code>{current.sha.slice(0, 7)}</code>
                      <span className={`commit-result ${current.result}`}>
                        {resultLabels[current.result]}
                      </span>
                    </div>
                    <p className="commit-detail-author">
                      {current.author} · {formatDate(current.date, true)}
                    </p>
                    <div
                      className="commit-detail-tabs"
                      role="group"
                      aria-label="커밋 상세 보기"
                    >
                      <button
                        aria-pressed={tab === "evidence"}
                        onClick={() => setTab("evidence")}
                      >
                        대응 근거
                      </button>
                      <button
                        aria-pressed={tab === "files"}
                        onClick={() => setTab("files")}
                      >
                        변경 파일
                      </button>
                    </div>
                    {tab === "evidence" ? (
                      <>
                        <dl className="commit-evidence">
                          <div>
                            <dt>기준 브랜치</dt>
                            <dd>
                              {comparison.baseBranch} ·{" "}
                              <code>{current.sha}</code>
                            </dd>
                          </div>
                          <div>
                            <dt>대응 커밋</dt>
                            <dd>
                              <code>
                                {current.target || "연결된 커밋 없음"}
                              </code>
                            </dd>
                          </div>
                          <div>
                            <dt>확인 근거</dt>
                            <dd>
                              {current.evidence ||
                                "조회 범위에서 대응 근거를 찾지 못했습니다."}
                            </dd>
                          </div>
                          {confirmation && (
                            <div>
                              <dt>확인 기록</dt>
                              <dd>
                                {confirmation.confirmedBy} ·{" "}
                                {formatDate(confirmation.confirmedAt, true)}
                              </dd>
                            </div>
                          )}
                        </dl>
                        <p className="commit-explanation">
                          체리픽으로 SHA가 달라질 수 있습니다. 변경 파일과
                          후보를 검토하세요. 대응 확인은 배포 완료를 보장하지
                          않습니다.
                        </p>
                        {!current.target && (
                          <div className="commit-manual">
                            <h3>대응 후보 검토 · 수동 지정</h3>
                            {current.candidates.length > 0 && (
                              <label>
                                대응 커밋 선택
                                <select
                                  disabled={busy}
                                  value={candidate}
                                  onChange={(e) => {
                                    candidateSequence.current++;
                                    setCandidate(e.target.value);
                                    setVerified(null);
                                  }}
                                >
                                  <option value="">후보 선택</option>
                                  {current.candidates.map((c) => (
                                    <option key={c.sha} value={c.sha}>
                                      {c.sha.slice(0, 7)} · {c.title}
                                    </option>
                                  ))}
                                </select>
                              </label>
                            )}
                            <label>
                              대응 커밋 SHA
                              <input
                                disabled={busy}
                                aria-label="대응 커밋 SHA"
                                value={candidate}
                                onChange={(e) => {
                                  candidateSequence.current++;
                                  setCandidate(e.target.value);
                                  setVerified(null);
                                }}
                                placeholder="7–40자리 SHA"
                              />
                            </label>
                            <button
                              className="quiet wide"
                              disabled={busy || !candidate.trim()}
                              onClick={() => void verify()}
                            >
                              대응 커밋 확인
                            </button>
                            {verified && (
                              <div className="commit-candidate-note">
                                <strong>{verified.title}</strong>
                                <p>
                                  {verified.author} ·{" "}
                                  <code>{verified.sha}</code>
                                </p>
                                {githubUrl(verified.url) && (
                                  <a
                                    href={githubUrl(verified.url)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                  >
                                    GitHub 후보 원본 보기
                                  </a>
                                )}
                                <p>
                                  저장 시 서버에서 대상 브랜치에 포함된 커밋인지
                                  검증합니다.
                                </p>
                              </div>
                            )}
                            <button
                              className="primary wide"
                              disabled={busy || !verified}
                              onClick={() => void save()}
                            >
                              대응 저장
                            </button>
                          </div>
                        )}
                        {/manual|수동/i.test(current.evidence) && (
                          <button
                            className="quiet wide"
                            disabled={busy}
                            onClick={() => void save(true)}
                          >
                            수동 대응 해제
                          </button>
                        )}
                      </>
                    ) : (
                      <div className="commit-files">
                        {detailBusy ? (
                          <p>변경 파일을 불러오는 중입니다.</p>
                        ) : detail ? (
                          <>
                            {!detail.filesComplete && (
                              <p>
                                파일 조회가 완전하지 않습니다. GitHub 원본에서
                                나머지를 확인해주세요.
                              </p>
                            )}
                            {!detail.files.length && (
                              <p>변경 파일이 없습니다.</p>
                            )}
                            {detail.files.map((f) => (
                              <article key={f.name}>
                                <strong>{f.name}</strong>
                                <span>
                                  <b className="added">+{f.added}</b>
                                  <b className="removed">-{f.removed}</b>{" "}
                                  {f.status}
                                </span>
                                {f.patch ? (
                                  <pre className="commit-patch">{f.patch}</pre>
                                ) : (
                                  <p>
                                    바이너리 또는 조회 제한으로 코드 차이가
                                    제공되지 않았습니다.
                                  </p>
                                )}
                              </article>
                            ))}
                          </>
                        ) : (
                          <p>
                            변경 파일을 가져오지 못했습니다. 상세를 다시 열어
                            재시도해주세요.
                          </p>
                        )}
                      </div>
                    )}
                    {originalUrl && (
                      <a
                        className="wide quiet commit-original"
                        href={originalUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        GitHub 원본 보기
                      </a>
                    )}
                  </section>
                )}
              </div>
            </>
          ) : (
            <div className="commit-empty">
              <h2>
                {loadingRepos || loadingBranches
                  ? "저장소·브랜치를 불러오는 중입니다"
                  : repositories.length
                    ? "조건을 선택하고 대조하기를 눌러주세요"
                    : "등록된 저장소가 없습니다"}
              </h2>
              <p>
                고객사에 등록된 저장소와 현재 GitHub 계정의 접근 권한을
                확인합니다.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
