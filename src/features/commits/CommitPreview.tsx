import { CompareGuide } from "./CompareGuide";
import { useEffect, useRef, useState } from "react";
import { Alert, PageTitle } from "../../components/UI";
import { useConfirm } from "../../components/Confirm";
import { formatDate } from "../../lib/domain";
import { demo } from "../../lib/supabase";
import {
  previewCommits,
  repositories,
  resultLabels,
  targetCommits,
} from "./preview";
import type { Commit, Repo, Result } from "./preview";
import "./commits.css";

type Scenario =
  | "ready"
  | "disconnected"
  | "loading"
  | "empty"
  | "denied"
  | "expired"
  | "error";
type Selection = {
  customer: string;
  repo: Repo;
  base: string;
  target: string;
  days: string;
};
const initial: Selection = {
  customer: "sample-one",
  repo: "web",
  base: "develop",
  target: "main",
  days: "30",
};
const exampleTime = Date.parse("2026-11-02T05:30:00Z");

export function CommitPreview({ ready = demo }: { ready?: boolean }) {
  const [scenario, setScenario] = useState<Scenario>(
    ready ? "ready" : "disconnected",
  );
  const [draft, setDraft] = useState(initial),
    [applied, setApplied] = useState(initial);
  const [filter, setFilter] = useState<Result | "all">("all"),
    [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null),
    [tab, setTab] = useState<"evidence" | "files">("evidence");
  const [links, setLinks] = useState<Record<string, string>>({}),
    [candidate, setCandidate] = useState("");
  const [notice, setNotice] = useState(""),
    [conditionError, setConditionError] = useState("");
  const detailHeading = useRef<HTMLHeadingElement>(null),
    trigger = useRef<HTMLButtonElement | null>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const confirm = useConfirm();
  const gated = ["disconnected", "denied", "expired"].includes(scenario);
  const changed = JSON.stringify(draft) !== JSON.stringify(applied);
  const repo = repositories.find((r) => r.id === applied.repo)!;
  const linkKey = (sha: string) =>
    `${applied.repo}:${applied.base}:${applied.target}:${sha}`;
  const rows =
    scenario === "empty"
      ? []
      : previewCommits(applied.repo)
          .filter(
            (c) =>
              exampleTime - Date.parse(c.date) <=
              Number(applied.days) * 86400000,
          )
          .map((c) =>
            links[linkKey(c.sha)]
              ? {
                  ...c,
                  result: "matched" as const,
                  target: links[linkKey(c.sha)],
                  evidence: "수동 연결",
                }
              : c,
          );
  const shown = rows.filter(
    (c) =>
      (filter === "all" || c.result === filter) &&
      `${c.title} ${c.sha} ${c.target || ""} ${c.author}`
        .toLowerCase()
        .includes(search.toLowerCase().trim()),
  );
  const current = rows.find((c) => c.sha === selected);
  function closeDetail() {
    setSelected(null);
    requestAnimationFrame(() => {
      if (trigger.current?.isConnected) trigger.current.focus();
      else searchInput.current?.focus();
    });
  }
  useEffect(() => {
    if (selected) detailHeading.current?.focus();
  }, [selected]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        selected &&
        !document.querySelector("dialog[open]")
      )
        closeDetail();
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [selected]);
  function state(value: Scenario) {
    setScenario(value);
    setSelected(null);
    setNotice("");
  }
  function compare(event: React.FormEvent) {
    event.preventDefault();
    if (draft.base === draft.target) {
      setConditionError("기준과 비교 대상은 서로 다른 브랜치를 선택해주세요.");
      return;
    }
    setConditionError("");
    setApplied({ ...draft });
    setSelected(null);
    setFilter("all");
    setSearch("");
    setScenario("ready");
    setNotice(
      "가상 데이터로 대조 결과를 갱신했습니다. 실제 GitHub 조회는 아직 연결하지 않았습니다.",
    );
  }
  async function connect(commit: Commit) {
    if (!candidate) return;
    if (
      !(await confirm({
        title: "가상 대응 커밋을 연결할까요?",
        message: `${commit.sha}에 ${candidate}을 대응시킵니다. UI 검토용이며 GitHub나 DB에는 저장하지 않습니다.`,
        action: "연결",
      }))
    )
      return;
    setLinks((old) => ({
      ...old,
      [linkKey(commit.sha)]: candidate,
    }));
    setNotice("가상 대응 연결을 적용했습니다. 새로고침하면 초기화됩니다.");
  }
  async function disconnect(commit: Commit) {
    if (
      !(await confirm({
        title: "가상 연결을 해제할까요?",
        message:
          "직접 지정한 대응 관계만 해제합니다. 원본 커밋과 GitHub 저장소에는 영향을 주지 않습니다.",
        action: "해제",
      }))
    )
      return;
    setLinks((old) => {
      const next = { ...old };
      delete next[linkKey(commit.sha)];
      return next;
    });
    setCandidate("");
    setNotice("가상 대응 연결을 해제했습니다.");
  }
  return (
    <div className={`commit-workspace ${current ? "has-detail" : ""}`}>
      <PageTitle
        title="커밋 대조"
        eyebrow=""
        description="브랜치 사이에 옮긴 변경과 아직 확인하지 못한 변경을 대조합니다."
        action={
          !gated && (
            <details className="commit-connection">
              <summary>가상 GitHub 연결</summary>
              <div>
                <strong>preview-user</strong>
                <p>
                  실제 계정이 아닙니다. OAuth 연결은 다음 단계에서 구현합니다.
                </p>
                <button className="quiet" onClick={() => state("disconnected")}>
                  연결 전 화면 보기
                </button>
              </div>
            </details>
          )
        }
      />
      <div className="commit-preview-bar">
        <div>
          <strong>UI 미리보기 · 가상 데이터</strong>
          <span>
            GitHub 인증·조회 없이 화면 흐름을 검토합니다. 요청 관리 데이터는
            변경하지 않습니다.
          </span>
        </div>
        <label>
          미리보기 상태
          <select
            value={scenario}
            onChange={(e) => state(e.target.value as Scenario)}
          >
            <option value="ready">대조 결과</option>
            <option value="disconnected">연결 전</option>
            <option value="loading">대조 중</option>
            <option value="empty">커밋 없음</option>
            <option value="denied">권한 부족</option>
            <option value="expired">연결 만료</option>
            <option value="error">조회 실패</option>
          </select>
        </label>
      </div>
      {gated ? (
        <section className="commit-gate">
          <svg
            width="44"
            height="44"
            viewBox="0 0 32 32"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden="true"
          >
            <circle cx="9" cy="7" r="3" />
            <circle cx="9" cy="25" r="3" />
            <circle cx="24" cy="7" r="3" />
            <path d="M9 10v12m15-12v3c0 6-15 2-15 9" />
          </svg>
          <h2>
            {scenario === "expired"
              ? "GitHub 재연결이 필요합니다"
              : scenario === "denied"
                ? "저장소 접근 권한을 확인해주세요"
                : "GitHub 연결부터 시작하세요"}
          </h2>
          <p>
            {scenario === "denied"
              ? "연결 계정에 권한이 없으면 비공개 저장소의 결과를 표시하지 않습니다."
              : "비공개 저장소에 접근하려면 GitHub에서 계정과 저장소 접근 권한을 승인해야 합니다."}
          </p>
          <button
            className="primary"
            disabled
            title="실제 인증은 다음 단계에서 연결합니다"
          >
            GitHub 연결 · 준비 중
          </button>
          <button className="text-button" onClick={() => state("ready")}>
            가상 데이터로 미리보기
          </button>
          <small>GitHub 비밀번호나 토큰을 이 화면에 입력하지 않습니다.</small>
        </section>
      ) : (
        <>
          <form className="commit-conditions" onSubmit={compare}>
            <label>
              고객사
              <select
                aria-label="고객사"
                value={draft.customer}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    customer: e.target.value,
                    repo: e.target.value === "sample-one" ? "web" : "portal",
                  }))
                }
              >
                <option value="sample-one">가상 고객사 A</option>
                <option value="sample-two">가상 고객사 B</option>
              </select>
            </label>
            <label>
              저장소
              <select
                aria-label="저장소"
                value={draft.repo}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, repo: e.target.value as Repo }))
                }
              >
                {repositories
                  .filter((r) => r.customer === draft.customer)
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              테스트 브랜치
              <select
                aria-label="테스트 브랜치"
                value={draft.base}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, base: e.target.value }))
                }
              >
                {["develop", "main", "release"].map((b) => (
                  <option key={b}>{b}</option>
                ))}
              </select>
              <small>확인할 변경이 있는 브랜치</small>
            </label>
            <label>
              운영 브랜치
              <select
                aria-label="운영 브랜치"
                value={draft.target}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, target: e.target.value }))
                }
              >
                {["main", "develop", "release"].map((b) => (
                  <option key={b}>{b}</option>
                ))}
              </select>
              <small>반영 여부를 확인할 브랜치</small>
            </label>
            <label>
              기준 커밋 기간
              <select
                aria-label="기준 커밋 기간"
                value={draft.days}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, days: e.target.value }))
                }
              >
                <option value="7">최근 7일</option>
                <option value="30">최근 30일</option>
                <option value="90">최근 90일</option>
              </select>
            </label>
            <button className="primary" disabled={scenario === "loading"}>
              대조하기
            </button>
          </form>
          <CompareGuide source={draft.base} target={draft.target} />
          {conditionError && <Alert>{conditionError}</Alert>}
          {changed && (
            <p className="commit-pending">
              비교 조건이 변경되었습니다. 대조하기를 눌러 적용하세요. 아래
              결과는 이전 조건입니다.
            </p>
          )}
          {scenario === "error" && (
            <Alert>
              조회 실패 예시입니다. 이전 대조 결과를 유지하고 있습니다.{" "}
              <button className="text-button" onClick={() => state("ready")}>
                다시 조회 예시
              </button>
            </Alert>
          )}
          {scenario === "loading" && (
            <Alert tone="info">
              대조 중인 화면 예시입니다. 마지막 결과를 유지합니다. 미리보기
              상태를 바꾸면 다른 화면을 확인할 수 있습니다.
            </Alert>
          )}
          {notice && <Alert tone="info">{notice}</Alert>}
          <div className="commit-scope">
            <div>
              <strong>{repo.path}</strong>
              <span>
                <code>{applied.base}</code> 기준 · <code>{applied.target}</code>{" "}
                대조
              </span>
            </div>
            <span>예시 기준 시각 · 2026. 11. 02. 14:30</span>
          </div>
          <p className="commit-scope-help">
            기준 커밋: 최근 {applied.days}일 · 대상 탐색: 전체 이력 예시 · 기준
            SHA: <code>a82d91c</code> / <code>f13a26b</code>. 실제 배포 여부를
            의미하지 않습니다.
          </p>
          <div className="commit-review-layout">
            <section
              className="commit-results"
              aria-label="커밋 대조 결과"
              aria-busy={scenario === "loading"}
            >
              <div className="commit-result-tools">
                <div
                  className="commit-filters"
                  role="group"
                  aria-label="대조 결과 필터"
                >
                  {(["all", "unmatched", "review", "matched"] as const).map(
                    (f) => (
                      <button
                        key={f}
                        className={filter === f ? "active" : ""}
                        aria-pressed={filter === f}
                        onClick={() => setFilter(f)}
                      >
                        {f === "all" ? "전체" : resultLabels[f]}{" "}
                        <span>
                          {f === "all"
                            ? rows.length
                            : rows.filter((c) => c.result === f).length}
                        </span>
                      </button>
                    ),
                  )}
                </div>
                <input
                  type="search"
                  ref={searchInput}
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
                        <th>{applied.base} 커밋</th>
                        <th>변경 내용</th>
                        <th>{applied.target} 반영</th>
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
                            <code>{c.sha}</code>
                          </td>
                          <td>
                            <button
                              className="commit-title"
                              aria-expanded={selected === c.sha}
                              aria-controls="commit-detail"
                              onClick={(e) => {
                                trigger.current = e.currentTarget;
                                setSelected(c.sha);
                                setCandidate(links[linkKey(c.sha)] || "");
                                setTab("evidence");
                              }}
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
                                <code>{c.target}</code>
                                <small>{c.evidence}</small>
                              </>
                            ) : (
                              <span className="commit-no-target">
                                {c.result === "review"
                                  ? "후보 검토 필요"
                                  : "미반영"}
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
                    {rows.length
                      ? "검색 조건에 맞는 커밋이 없습니다"
                      : "조회 범위에 커밋이 없습니다"}
                  </h2>
                  <p>
                    {rows.length
                      ? "검색어나 결과 필터를 바꿔보세요."
                      : "테스트 브랜치와 조회 기간을 확인해주세요. 오류와 커밋 없음은 별도로 표시합니다."}
                  </p>
                  {rows.length > 0 && (
                    <button
                      className="quiet"
                      onClick={() => {
                        setFilter("all");
                        setSearch("");
                      }}
                    >
                      검색·필터 초기화
                    </button>
                  )}
                </div>
              )}
              <p className="commit-result-foot">
                메시지가 유사한 커밋은 자동 확정하지 않습니다. 미반영은
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
                <h2 ref={detailHeading} tabIndex={-1}>
                  {current.title}
                </h2>
                <div className="commit-detail-id">
                  <code>{current.sha}</code>
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
                    반영 근거
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
                        <dt>테스트 브랜치</dt>
                        <dd>
                          {applied.base} · <code>{current.sha}</code>
                        </dd>
                      </div>
                      <div>
                        <dt>대응 커밋</dt>
                        <dd>
                          {current.target ? (
                            <code>{current.target}</code>
                          ) : (
                            "연결된 커밋 없음"
                          )}
                        </dd>
                      </div>
                      <div>
                        <dt>확인 근거</dt>
                        <dd>
                          {current.evidence ||
                            "조회 범위에서 반영 근거를 찾지 못했습니다."}
                        </dd>
                      </div>
                    </dl>
                    <p className="commit-explanation">
                      {current.evidence === "수동 연결"
                        ? "검토자가 직접 지정한 관계의 예시입니다. 현재 화면에서만 유지됩니다."
                        : current.result === "matched"
                          ? "커밋 대응을 확인한 예시입니다. 서버 배포 완료나 이후 되돌리기 여부를 보장하지 않습니다."
                          : "체리픽으로 SHA가 달라질 수 있습니다. 변경 파일과 대응 후보를 확인하세요."}
                    </p>
                    {!current.target && (
                      <div className="commit-manual">
                        <h3>
                          {current.result === "review"
                            ? "대응 후보 검토"
                            : "수동으로 대응 지정"}
                        </h3>
                        <p>
                          아래 후보는 가상 데이터입니다. 실제 일치 판단은 아직
                          수행하지 않습니다.
                        </p>
                        <label>
                          대응 커밋 선택
                          <select
                            value={candidate}
                            onChange={(e) => setCandidate(e.target.value)}
                          >
                            <option value="">커밋을 선택하세요</option>
                            {targetCommits.map((c) => (
                              <option key={c.sha} value={c.sha}>
                                {c.sha} · {c.title}
                              </option>
                            ))}
                          </select>
                        </label>
                        {candidate && (
                          <p className="commit-candidate-note">
                            {
                              targetCommits.find((c) => c.sha === candidate)
                                ?.note
                            }
                          </p>
                        )}
                        <button
                          className="primary wide"
                          disabled={!candidate}
                          onClick={() => void connect(current)}
                        >
                          가상 대응 연결
                        </button>
                      </div>
                    )}
                    {current.evidence === "수동 연결" && (
                      <button
                        className="wide quiet"
                        onClick={() => void disconnect(current)}
                      >
                        가상 연결 해제
                      </button>
                    )}
                  </>
                ) : (
                  <div className="commit-files">
                    <p>변경 파일과 수정 규모의 예시입니다.</p>
                    {current.files.map((file) => (
                      <article key={file.name}>
                        <strong>{file.name}</strong>
                        <span>
                          <b className="added">+{file.added}</b>
                          <b className="removed">-{file.removed}</b>
                        </span>
                      </article>
                    ))}
                    <p className="commit-explanation">
                      실제 코드 차이는 GitHub API 연동 후 제공합니다. 현재
                      화면에는 소스 코드를 가져오지 않습니다.
                    </p>
                  </div>
                )}
                <button
                  className="wide quiet commit-original"
                  disabled
                  title="실제 GitHub 연동 후 원본 커밋을 엽니다"
                >
                  GitHub 원본 보기 · 준비 중
                </button>
              </section>
            )}
          </div>
        </>
      )}
    </div>
  );
}
