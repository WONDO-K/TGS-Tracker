import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { Alert, Loading } from "../../components/UI";
import { useSession } from "../../app/Session";
import {
  getRequest,
  getActivities,
  getAttachments,
  rpc,
  uploadAttachment,
  deleteAttachment,
  retryUpload,
} from "../../lib/api";
import {
  deploymentLabel,
  errorMessage,
  formatDate,
  isoKST,
  localDatetime,
  statuses,
  validateDeployment,
} from "../../lib/domain";
import { client, demo } from "../../lib/supabase";
import { prepareImage } from "../../lib/image";
import type { Activity, Attachment, RequestRow, Status } from "../../lib/types";
import { ImagePicker } from "./Images";
export function RequestDetail() {
  const { id } = useParams(),
    location = useLocation(),
    { customers, people, profile } = useSession();
  const [row, setRow] = useState<RequestRow | null>(null),
    [form, setForm] = useState<RequestRow | null>(null),
    [activities, setActivities] = useState<Activity[]>([]),
    [attachments, setAttachments] = useState<Attachment[]>([]),
    [error, setError] = useState(""),
    [message, setMessage] = useState(location.state?.notice || ""),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [body, setBody] = useState(""),
    [kind, setKind] = useState("action"),
    [files, setFiles] = useState<File[]>([]);
  const reservations = useRef(new Map<File, Attachment>());
  const load = useCallback(
    async (resetForm = true) => {
      try {
        if (resetForm) {
          const r = await getRequest(id!);
          setRow(r);
          setForm(r);
        }
        const [a, f] = await Promise.all([
          getActivities(id!),
          getAttachments(id!),
        ]);
        setActivities(a);
        setAttachments(f);
      } catch (e) {
        setError(errorMessage(e));
      } finally {
        setLoading(false);
      }
    },
    [id],
  );
  useEffect(() => {
    void load();
  }, [load]);
  const customer = customers.find((c) => c.id === row?.customer_id),
    writable = !demo && !!customer?.is_active && !row?.archived_at;
  function field<K extends keyof RequestRow>(key: K, value: RequestRow[K]) {
    setForm((f) => (f ? { ...f, [key]: value } : f));
  }
  async function run(
    action: () => Promise<void>,
    success: string,
    resetForm = false,
  ) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await action();
      await load(resetForm);
      setMessage(success);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form || !row) return;
    await run(
      async () => {
        validateDeployment(
          form.requires_deployment,
          localDatetime(form.test_deployed_at),
          localDatetime(form.production_deployed_at),
        );
        const {
          title,
          description,
          requester_name,
          requested_on,
          status,
          requires_deployment,
          test_deployed_at,
          production_deployed_at,
          action_summary,
        } = form;
        await rpc("update_request", {
          id: row.id,
          expected_version: row.version,
          patch: {
            title,
            description,
            requester_name,
            requested_on,
            status,
            requires_deployment,
            test_deployed_at,
            production_deployed_at,
            action_summary,
          },
        });
      },
      "변경사항을 저장했습니다.",
      true,
    );
  }
  async function sendActivity(e: React.FormEvent) {
    e.preventDefault();
    await run(async () => {
      await rpc("add_request_activity", { request_id: id, kind, body });
      setBody("");
    }, "기록을 추가했습니다.");
  }
  async function addFiles() {
    await run(async () => {
      for (const file of files) {
        const reserved = reservations.current.get(file);
        if (reserved) await retryUpload(reserved, file);
        else
          await uploadAttachment(id!, file, (a) =>
            reservations.current.set(file, a),
          );
        reservations.current.delete(file);
        setFiles((v) => v.filter((f) => f !== file));
      }
    }, "이미지를 첨부했습니다.");
    await refreshAttachments();
  }
  async function refreshAttachments() {
    try {
      setAttachments(await getAttachments(id!));
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  if (loading) return <Loading />;
  if (!row || !form)
    return (
      <Alert>{error || "요청을 찾을 수 없거나 접근 권한이 없습니다."}</Alert>
    );
  const person = (uid: string) =>
    people.find((p) => p.id === uid)?.display_name || "사용자";
  return (
    <>
      <Link className="back-link" to={location.state?.returnTo || "/board"}>
        목록으로 돌아가기
      </Link>
      <div className="detail-heading">
        <div>
          <div className="request-context">
            {customer?.name} / REQUEST #{row.number}
          </div>
          <h1>{row.title}</h1>
          <p className="muted">
            {person(row.created_by)} 등록 · {formatDate(row.created_at, true)}{" "}
            {row.archived_at && "· 보관됨"}
          </p>
        </div>
        <span className={`status-pill ${row.status}`}>
          {statuses[row.status]}
        </span>
      </div>
      {error && (
        <Alert>
          {error}{" "}
          <button
            className="text-button"
            onClick={() => {
              if (
                window.confirm(
                  "입력 중인 변경사항을 버리고 최신 내용을 불러올까요?",
                )
              )
                void load();
            }}
          >
            최신 내용 불러오기
          </button>
        </Alert>
      )}
      {message && <Alert tone="info">{message}</Alert>}
      {!writable && (
        <Alert tone="info">
          {demo
            ? "포트폴리오 데모입니다. 가상 요청을 읽기 전용으로 제공합니다."
            : "사용 중지 고객사 또는 보관된 요청은 읽기 전용입니다."}
        </Alert>
      )}
      <div className="detail-grid">
        <div>
          <form className="form-panel" onSubmit={save}>
            <h2>요청 및 조치 내용</h2>
            <fieldset disabled={!writable || busy}>
              <label>
                제목
                <input
                  required
                  maxLength={150}
                  value={form.title}
                  onChange={(e) => field("title", e.target.value)}
                />
              </label>
              <label>
                요청 내용
                <textarea
                  required
                  rows={6}
                  maxLength={10000}
                  value={form.description}
                  onChange={(e) => field("description", e.target.value)}
                />
              </label>
              <div className="form-grid">
                <label>
                  요청일
                  <input
                    type="date"
                    required
                    value={form.requested_on}
                    onChange={(e) => field("requested_on", e.target.value)}
                  />
                </label>
                <label>
                  고객사 요청자
                  <input
                    maxLength={80}
                    value={form.requester_name || ""}
                    onChange={(e) => field("requester_name", e.target.value)}
                  />
                </label>
              </div>
              <label>
                고객사 전달용 조치 요약
                <textarea
                  rows={4}
                  maxLength={10000}
                  value={form.action_summary}
                  onChange={(e) => field("action_summary", e.target.value)}
                  placeholder="고객사에 전달할 결과를 정리하세요. 내부 메모와 구분됩니다."
                />
              </label>
              <hr />
              <h2>진행 및 배포</h2>
              <div className="form-grid">
                <label>
                  진행 상태
                  <select
                    value={form.status}
                    onChange={(e) => field("status", e.target.value as Status)}
                  >
                    {Object.entries(statuses).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={form.requires_deployment}
                    onChange={(e) => {
                      if (
                        !e.target.checked &&
                        (form.test_deployed_at ||
                          form.production_deployed_at) &&
                        !window.confirm(
                          "배포 불필요로 변경하면 기존 반영일이 비워집니다. 계속할까요?",
                        )
                      )
                        return;
                      setForm((f) =>
                        f
                          ? {
                              ...f,
                              requires_deployment: e.target.checked,
                              ...(!e.target.checked
                                ? {
                                    test_deployed_at: null,
                                    production_deployed_at: null,
                                  }
                                : {}),
                            }
                          : f,
                      );
                    }}
                  />
                  서버 배포 필요
                </label>
              </div>
              <div className="form-grid">
                <label>
                  테스트 반영일 (한국 시간)
                  <input
                    type="datetime-local"
                    disabled={!form.requires_deployment}
                    value={localDatetime(form.test_deployed_at)}
                    onChange={(e) =>
                      field("test_deployed_at", isoKST(e.target.value))
                    }
                  />
                </label>
                <label>
                  운영 반영일 (한국 시간)
                  <input
                    type="datetime-local"
                    disabled={!form.requires_deployment}
                    value={localDatetime(form.production_deployed_at)}
                    onChange={(e) =>
                      field("production_deployed_at", isoKST(e.target.value))
                    }
                  />
                </label>
              </div>
              {form.production_deployed_at && !form.test_deployed_at && (
                <p className="hint">
                  테스트 반영일이 없습니다. 운영에 바로 반영한 요청인지
                  확인해주세요.
                </p>
              )}
              {writable && (
                <div className="form-actions">
                  <button className="primary" disabled={busy}>
                    {busy ? "저장 중…" : "변경사항 저장"}
                  </button>
                </div>
              )}
            </fieldset>
          </form>
          <section className="form-panel">
            <h2>
              첨부 이미지{" "}
              <span className="count">
                {attachments.filter((a) => a.state === "ready").length}
              </span>
            </h2>
            <div className="attachment-grid">
              {attachments.map((a) => (
                <AttachmentItem
                  key={a.id}
                  item={a}
                  canManage={
                    writable &&
                    (a.created_by === profile?.id || profile?.role === "admin")
                  }
                  busy={busy}
                  run={run}
                />
              ))}
            </div>
            {!attachments.length && (
              <p className="muted">첨부된 이미지가 없습니다.</p>
            )}
            {writable && (
              <>
                <ImagePicker
                  files={files}
                  onChange={setFiles}
                  disabled={busy}
                  remaining={Math.max(
                    0,
                    5 -
                      attachments.length +
                      files.filter((f) => reservations.current.has(f)).length,
                  )}
                />
                {files.length > 0 && (
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() => void addFiles()}
                  >
                    선택 이미지 저장
                  </button>
                )}
              </>
            )}
          </section>
        </div>
        <aside>
          <section className="detail-summary">
            <span className="request-context">운영 반영 확인</span>
            <h2>{deploymentLabel(row)}</h2>
            <dl>
              <div>
                <dt>테스트 서버</dt>
                <dd>
                  {row.requires_deployment
                    ? formatDate(row.test_deployed_at)
                    : "해당 없음"}
                </dd>
              </div>
              <div>
                <dt>운영 서버</dt>
                <dd>
                  {row.requires_deployment
                    ? formatDate(row.production_deployed_at)
                    : "해당 없음"}
                </dd>
              </div>
              <div>
                <dt>최근 수정</dt>
                <dd>
                  {person(row.updated_by)}
                  <br />
                  {formatDate(row.updated_at, true)}
                </dd>
              </div>
            </dl>
            <small>완료 처리와 운영 반영 기록은 별개입니다.</small>
          </section>
          <section className="form-panel activity-panel">
            <h2>활동 기록</h2>
            {writable && (
              <form onSubmit={sendActivity}>
                <label className="sr-only" htmlFor="activity-kind">
                  기록 유형
                </label>
                <select
                  id="activity-kind"
                  value={kind}
                  onChange={(e) => setKind(e.target.value)}
                >
                  <option value="action">조치 기록</option>
                  <option value="note">내부 메모</option>
                </select>
                <label className="sr-only" htmlFor="activity-body">
                  활동 내용
                </label>
                <textarea
                  id="activity-body"
                  required
                  maxLength={10000}
                  rows={3}
                  placeholder="진행 내용이나 내부 메모를 남겨주세요"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                />
                <button disabled={busy || !body.trim()} className="wide">
                  기록 추가
                </button>
              </form>
            )}
            <div className="timeline">
              {activities.map((a) => (
                <article key={a.id}>
                  <span className={`activity-kind ${a.kind}`}>
                    {a.kind === "action"
                      ? "조치"
                      : a.kind === "note"
                        ? "내부 메모"
                        : "변경"}
                  </span>
                  <strong>{person(a.created_by)}</strong>
                  <p>{a.body}</p>
                  {a.kind === "system" && Boolean(a.metadata.before) && (
                    <small className="event-details">
                      {eventText(a.metadata)}
                    </small>
                  )}
                  <time>{formatDate(a.created_at, true)}</time>
                </article>
              ))}
              {!activities.length && (
                <p className="muted">아직 활동 기록이 없습니다.</p>
              )}
            </div>
          </section>
          {!demo && profile?.role === "admin" && (
            <button
              className="danger wide"
              disabled={busy}
              onClick={() => {
                if (
                  window.confirm(
                    row.archived_at
                      ? "요청을 복원할까요?"
                      : "요청을 보관할까요? 보관 후에는 읽기 전용이 됩니다.",
                  )
                )
                  void run(
                    async () => {
                      await rpc("set_request_archived", {
                        id: row.id,
                        expected_version: row.version,
                        archived: !row.archived_at,
                      });
                    },
                    row.archived_at ? "복원했습니다." : "보관했습니다.",
                    true,
                  );
              }}
            >
              {row.archived_at ? "요청 복원" : "요청 보관"}
            </button>
          )}
        </aside>
      </div>
    </>
  );
}
function eventText(metadata: Record<string, unknown>) {
  const before = metadata.before as {
      status: Status;
      test: string | null;
      production: string | null;
      required: boolean;
    },
    after = metadata.after as typeof before;
  return `${statuses[before.status]} → ${statuses[after.status]} · 테스트 ${formatDate(after.test)} · 운영 ${formatDate(after.production)}${!after.required ? " · 배포 불필요" : ""}`;
}
function AttachmentItem({
  item: a,
  canManage,
  busy,
  run,
}: {
  item: Attachment;
  canManage: boolean;
  busy: boolean;
  run: (
    action: () => Promise<void>,
    success: string,
    reload?: boolean,
  ) => Promise<void>;
}) {
  const [url, setUrl] = useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    let disposed = false,
      objectUrl = "";
    if (a.state === "ready") {
      void client()
        .storage.from("request-images")
        .download(a.storage_path)
        .then(({ data, error }) => {
          if (disposed) return;
          if (error) setError(error.message);
          else if (data) {
            objectUrl = URL.createObjectURL(data);
            setUrl(objectUrl);
          }
        });
    }
    return () => {
      disposed = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [a.storage_path, a.state]);
  return (
    <figure className="attachment">
      {url ? (
        <a href={url} target="_blank" rel="noreferrer">
          <img src={url} alt={a.original_name} />
        </a>
      ) : (
        <div className="attachment-placeholder">
          {error ||
            (a.state === "pending" ? "업로드 미완료" : "이미지 불러오는 중…")}
        </div>
      )}
      <figcaption>
        {a.original_name}
        <small>
          {Math.ceil(a.size_bytes / 1024)}KB ·{" "}
          {a.state === "ready" ? "저장됨" : "예약됨"}
        </small>
      </figcaption>
      {canManage && (
        <div className="attachment-actions">
          {a.state === "pending" && (
            <>
              <button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await rpc("finalize_attachment", { id: a.id });
                  }, "첨부를 확인했습니다.")
                }
              >
                업로드 확인
              </button>
              <label className="button">
                다시 선택
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  hidden
                  disabled={busy}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file)
                      void run(
                        async () => retryUpload(a, await prepareImage(file)),
                        "다시 첨부했습니다.",
                      );
                  }}
                />
              </label>
            </>
          )}
          <button
            className="danger"
            disabled={busy}
            onClick={() => {
              if (window.confirm("첨부 이미지를 삭제할까요?"))
                void run(
                  async () => deleteAttachment(a),
                  "이미지를 삭제했습니다.",
                );
            }}
          >
            삭제
          </button>
        </div>
      )}
    </figure>
  );
}
