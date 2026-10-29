import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "../../app/Session";
import { useConfirm } from "../../components/Confirm";
import { client } from "../../lib/supabase";
import { rpc } from "../../lib/api";
import { errorMessage } from "../../lib/domain";
import type { Customer, Profile } from "../../lib/types";
import { Alert, Loading, PageTitle } from "../../components/UI";
import "./admin.css";

function adminError(error: unknown) {
  const message = errorMessage(error);
  if (/마지막 활성 관리자/.test(message))
    return "마지막 활성 관리자는 차단하거나 일반 사용자로 변경할 수 없습니다. 먼저 다른 사용자를 관리자로 지정해주세요.";
  if (/duplicate|unique|23505|중복/i.test(message))
    return "이미 등록된 정보입니다. 고객사 코드 또는 이메일을 확인해주세요. 기존 사용자에게는 설정 링크를 재발송할 수 있습니다.";
  return message;
}
const blankCustomer = { id: "", name: "", code: "", is_active: true };
export function Customers() {
  const { customers, reload } = useSession();
  const [form, setForm] = useState<Customer>(blankCustomer),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const pending = useRef(false),
    nameInput = useRef<HTMLInputElement>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending.current) return;
    if (!form.name.trim()) {
      setError("고객사명을 입력해주세요.");
      return;
    }
    pending.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await rpc("save_customer", {
        ...form,
        name: form.name.trim(),
        id: form.id || null,
      });
      await reload();
      setForm(blankCustomer);
      setMessage("고객사 정보를 저장했습니다.");
    } catch (e) {
      setError(adminError(e));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  function edit(customer: Customer) {
    setForm(customer);
    setMessage("");
    setError("");
    nameInput.current?.focus();
  }
  return (
    <div className="admin-screen">
      <PageTitle
        eyebrow="ADMINISTRATION"
        title="고객사 관리"
        description={`전체 ${customers.length}곳 · 활성 ${customers.filter((c) => c.is_active).length}곳`}
        action={
          <button
            className="primary"
            disabled={busy}
            onClick={() => edit(blankCustomer)}
          >
            + 고객사 추가
          </button>
        }
      />
      {message && <Alert tone="success">{message}</Alert>}
      <div className="admin-layout">
        <section className="table-wrap admin-table" aria-label="고객사 목록">
          <table>
            <thead>
              <tr>
                <th>고객사</th>
                <th>코드</th>
                <th>상태</th>
                <th>관리</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => (
                <tr key={c.id} className={form.id === c.id ? "selected" : ""}>
                  <td>
                    <strong>{c.name}</strong>
                  </td>
                  <td>
                    <code>{c.code}</code>
                  </td>
                  <td>
                    <span
                      className={`status-pill ${c.is_active ? "completed" : "received"}`}
                    >
                      {c.is_active ? "활성" : "사용 중지"}
                    </span>
                  </td>
                  <td>
                    <button
                      disabled={busy}
                      aria-label={`${c.name} 수정`}
                      onClick={() => edit(c)}
                    >
                      수정
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!customers.length && (
            <div className="empty">
              등록된 고객사가 없습니다. 첫 고객사를 추가해주세요.
            </div>
          )}
        </section>
        <aside>
          <section className="form-panel admin-editor">
            <h2>{form.id ? "고객사 수정" : "고객사 등록"}</h2>
            {error && <Alert>{error}</Alert>}
            <form onSubmit={submit} aria-busy={busy}>
              <fieldset disabled={busy}>
                <label>
                  이름
                  <input
                    ref={nameInput}
                    required
                    maxLength={80}
                    value={form.name}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, name: e.target.value }))
                    }
                    placeholder="고객사명"
                  />
                </label>
                <label>
                  코드
                  <input
                    required
                    pattern="[A-Za-z0-9_-]{1,20}"
                    maxLength={20}
                    value={form.code}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        code: e.target.value.toUpperCase(),
                      }))
                    }
                    placeholder="예: TGS"
                    aria-describedby="customer-code-hint"
                  />
                </label>
                <p className="hint" id="customer-code-hint">
                  영문·숫자·밑줄·하이픈, 최대 20자
                </p>
                <label className="admin-switch">
                  활성 상태
                  <input
                    type="checkbox"
                    checked={form.is_active}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, is_active: e.target.checked }))
                    }
                  />
                  <span aria-hidden="true" />
                </label>
                <p className="admin-note warning">
                  사용을 중지하면 새 요청 등록과 기존 요청 수정이 차단됩니다.
                  기존 담당자는 조회만 할 수 있습니다.
                </p>
                <div className="form-actions">
                  <button
                    type="button"
                    onClick={() => {
                      setForm(blankCustomer);
                      setError("");
                    }}
                  >
                    취소
                  </button>
                  <button className="primary">
                    {busy ? "저장 중…" : "저장"}
                  </button>
                </div>
              </fieldset>
            </form>
          </section>
          <p className="admin-footnote">
            고객사는 삭제할 수 없고, 사용 중지로만 정리합니다.
          </p>
        </aside>
      </div>
    </div>
  );
}
interface Member {
  customer_id: string;
  user_id: string;
}
type AdminProfile = Profile & { last_invited_at?: string | null };
export function Users() {
  const { customers, reload } = useSession(),
    confirm = useConfirm();
  const [users, setUsers] = useState<AdminProfile[]>([]),
    [members, setMembers] = useState<Member[]>([]),
    [selected, setSelected] = useState(""),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [loadError, setLoadError] = useState(""),
    [message, setMessage] = useState(""),
    [inviteError, setInviteError] = useState(""),
    [email, setEmail] = useState(""),
    [name, setName] = useState(""),
    [sentAt, setSentAt] = useState<Record<string, number>>({}),
    [now, setNow] = useState(Date.now());
  const pending = useRef(false),
    inviteDialog = useRef<HTMLDialogElement>(null);
  const load = useCallback(async () => {
    const [u, m] = await Promise.all([
      client().from("profiles").select("*").order("created_at"),
      client().from("customer_members").select("customer_id,user_id"),
    ]);
    if (u.error) throw u.error;
    if (m.error) throw m.error;
    setUsers(u.data);
    setMembers(m.data);
    setSelected((current) => current || u.data[0]?.id || "");
    setLoadError("");
  }, []);
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      await load();
    } catch (e) {
      setLoadError(adminError(e));
    } finally {
      setLoading(false);
    }
  }, [load]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const selectedUser = users.find((u) => u.id === selected),
    existingUser = users.find(
      (u) => u.email.toLowerCase() === email.trim().toLowerCase(),
    );
  const cooldown = Math.max(
    0,
    Math.ceil(
      ((sentAt[email.trim().toLowerCase()] ||
        (existingUser?.last_invited_at
          ? new Date(existingUser.last_invited_at).getTime()
          : 0)) +
        60000 -
        now) /
        1000,
    ),
  );
  async function invite(e: React.FormEvent) {
    e.preventDefault();
    if (pending.current || cooldown) return;
    if (!name.trim()) {
      setInviteError("이름을 입력해주세요.");
      return;
    }
    pending.current = true;
    setBusy(true);
    setInviteError("");
    setMessage("");
    try {
      const { data, error } = await client().functions.invoke("invite-user", {
        body: { email: email.trim().toLowerCase(), display_name: name.trim() },
      });
      if (error) {
        let detail =
          "초대 메일을 보내지 못했습니다. 잠시 후 다시 시도해주세요.";
        try {
          detail = (await error.context.json()).error || detail;
        } catch {
          /* 응답 본문이 없는 전송 오류 */
        }
        throw new Error(detail);
      }
      if (data?.error) throw new Error(data.error);
      setSentAt((v) => ({ ...v, [email.trim().toLowerCase()]: Date.now() }));
      inviteDialog.current?.close();
      setEmail("");
      setName("");
      setMessage(
        "초대 또는 비밀번호 설정 메일을 발송했습니다. 담당 고객사도 배정해주세요.",
      );
      try {
        await load();
        await reload();
      } catch (e) {
        setLoadError(`메일은 발송했습니다. 목록 갱신 실패: ${adminError(e)}`);
      }
    } catch (e) {
      const detail = adminError(e);
      if (/1분|60초|rate.limit|too.many/i.test(detail)) {
        setSentAt((v) => ({ ...v, [email.trim().toLowerCase()]: Date.now() }));
        setInviteError(
          "재발송은 60초 간격으로 가능합니다. 잠시 후 다시 보내주세요. 메일이 보이지 않으면 스팸함도 확인해주세요.",
        );
      } else setInviteError(detail);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  async function save(
    user: AdminProfile,
    role: Profile["role"],
    active: boolean,
    ids: string[],
  ) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    let accessSaved = false;
    try {
      if (
        user.role === "admin" &&
        user.is_active &&
        (role !== "admin" || !active) &&
        users.filter((u) => u.role === "admin" && u.is_active).length <= 1
      )
        throw new Error("마지막 활성 관리자");
      if (
        role === "admin" &&
        user.role !== "admin" &&
        !(await confirm({
          title: `${user.display_name} 관리자 승격`,
          message: `관리자는 담당 배정과 관계없이 전체 ${customers.length}곳의 고객사 자료에 접근하고 고객사·사용자·권한을 관리할 수 있습니다.`,
          consent: "모든 고객사의 데이터에 접근하게 됨을 확인했습니다.",
          action: "관리자로 변경",
        }))
      )
        return;
      if (
        !active &&
        user.is_active &&
        !(await confirm({
          title: `${user.display_name} 접근 차단`,
          message:
            "로그인 중인 세션도 이후 요청부터 데이터와 이미지를 받을 수 없습니다. 작성한 요청·기록과 담당 고객사 배정은 보존되며 언제든 다시 허용할 수 있습니다.",
          danger: true,
          action: "접근 차단",
        }))
      )
        return;
      // 앞선 부분 저장이 성공했을 수 있으므로 재시도에서도 원하는 접근 상태를 확정한다.
      {
        await rpc("set_user_access", {
          user_id: user.id,
          role,
          is_active: active,
        });
        accessSaved = true;
      }
      await rpc("set_customer_members", {
        user_id: user.id,
        customer_ids: ids,
      });
      setMessage("사용자 설정을 저장했습니다.");
      try {
        await load();
        await reload();
      } catch (e) {
        setLoadError(`설정은 저장했습니다. 목록 갱신 실패: ${adminError(e)}`);
      }
    } catch (e) {
      setError(
        `${accessSaved ? "역할·접근 상태는 저장했지만 고객사 배정을 완료하지 못했습니다. 입력을 유지했으니 다시 저장해주세요. " : ""}${adminError(e)}`,
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  function openInvite(user?: Profile) {
    if (user) {
      setEmail(user.email);
      setName(user.display_name);
    }
    setInviteError("");
    inviteDialog.current?.showModal();
  }
  return (
    <div className="admin-screen">
      <PageTitle
        eyebrow="ADMINISTRATION"
        title="사용자 관리"
        description={
          loading && !users.length
            ? "사용자 정보를 불러오는 중입니다."
            : `전체 ${users.length}명 · 관리자 ${users.filter((u) => u.role === "admin").length}명`
        }
        action={
          <button
            className="primary"
            disabled={busy}
            onClick={() => openInvite()}
          >
            + 사용자 초대
          </button>
        }
      />
      {message && <Alert tone="success">{message}</Alert>}
      <div className="admin-layout">
        <section className="table-wrap admin-table" aria-label="사용자 목록">
          {loadError && (
            <Alert>
              {loadError}{" "}
              <button disabled={busy || loading} onClick={() => void refresh()}>
                다시 불러오기
              </button>
            </Alert>
          )}
          {loading && !users.length ? (
            <Loading />
          ) : (
            <>
              <table>
                <thead>
                  <tr>
                    <th>사용자</th>
                    <th>역할</th>
                    <th>담당 고객사</th>
                    <th>상태</th>
                    <th>관리</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr
                      key={u.id}
                      className={selected === u.id ? "selected" : ""}
                    >
                      <td>
                        <div className="admin-identity">
                          <span className="avatar">
                            {u.display_name.slice(0, 1)}
                          </span>
                          <div>
                            <strong>{u.display_name}</strong>
                            <small>{u.email}</small>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span
                          className={`admin-role ${u.role === "admin" ? "administrator" : ""}`}
                        >
                          {u.role === "admin" ? "관리자" : "일반"}
                        </span>
                      </td>
                      <td>
                        <div className="admin-customer-tags">
                          {u.role === "admin" ? (
                            <span>전체</span>
                          ) : members.filter((m) => m.user_id === u.id)
                              .length ? (
                            members
                              .filter((m) => m.user_id === u.id)
                              .map((m) => (
                                <span key={m.customer_id}>
                                  {customers.find((c) => c.id === m.customer_id)
                                    ?.name || "고객사"}
                                </span>
                              ))
                          ) : (
                            <small>배정 없음</small>
                          )}
                        </div>
                      </td>
                      <td>
                        <span
                          className={`status-pill ${u.is_active ? "completed" : "received"}`}
                        >
                          {u.is_active ? "활성" : "접근 차단"}
                        </span>
                      </td>
                      <td>
                        <button
                          disabled={busy}
                          aria-label={`${u.display_name} 관리`}
                          onClick={() => {
                            setSelected(u.id);
                            setError("");
                          }}
                        >
                          관리
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!users.length && !loadError && (
                <div className="empty">
                  등록된 사용자가 없습니다. 동료를 초대해주세요.
                </div>
              )}
            </>
          )}
        </section>
        <aside>
          {selectedUser ? (
            <UserEditor
              key={selectedUser.id}
              user={selectedUser}
              customers={customers}
              assigned={members
                .filter((m) => m.user_id === selectedUser.id)
                .map((m) => m.customer_id)}
              busy={busy}
              error={error}
              save={(role, active, ids) =>
                save(selectedUser, role, active, ids)
              }
              resend={() => openInvite(selectedUser)}
            />
          ) : (
            <section className="form-panel">
              <h2>접근 설정</h2>
              <p className="hint">
                사용자 목록에서 관리할 동료를 선택해주세요.
              </p>
            </section>
          )}
        </aside>
      </div>
      <dialog
        ref={inviteDialog}
        className="admin-invite-dialog"
        aria-labelledby="invite-title"
        onCancel={(e) => {
          if (busy) e.preventDefault();
        }}
      >
        <h2 id="invite-title">동료를 초대합니다</h2>
        <p>입력한 이메일로 비밀번호 설정 링크를 보냅니다.</p>
        {inviteError && <Alert>{inviteError}</Alert>}
        <form onSubmit={invite} aria-busy={busy}>
          <fieldset disabled={busy}>
            <label>
              이름
              <input
                autoFocus
                required
                maxLength={80}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="예: 이서연"
              />
            </label>
            <label>
              회사 이메일
              <input
                required
                type="email"
                maxLength={254}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@company.com"
              />
            </label>
            <p className="admin-note">
              {existingUser
                ? "이미 등록된 이메일입니다. 기존 계정에는 초대 또는 비밀번호 재설정 링크를 보내며 역할과 담당 고객사는 유지됩니다."
                : "담당 고객사는 초대 후 사용자 관리에서 배정합니다. 배정 전에는 로그인해도 업무 데이터가 보이지 않습니다."}
            </p>
            {cooldown > 0 && (
              <p className="admin-note warning" role="status">
                재발송까지 {cooldown}초 · 스팸함도 확인해주세요.
              </p>
            )}
            <div className="form-actions">
              <button
                type="button"
                onClick={() => inviteDialog.current?.close()}
              >
                취소
              </button>
              <button className="primary" disabled={cooldown > 0}>
                {busy
                  ? "발송 중…"
                  : existingUser
                    ? "설정 링크 재발송"
                    : "초대 메일 보내기"}
              </button>
            </div>
          </fieldset>
        </form>
      </dialog>
    </div>
  );
}
function UserEditor({
  user: u,
  customers,
  assigned,
  busy,
  error,
  save,
  resend,
}: {
  user: Profile;
  customers: Customer[];
  assigned: string[];
  busy: boolean;
  error: string;
  save: (
    role: Profile["role"],
    active: boolean,
    ids: string[],
  ) => Promise<void>;
  resend: () => void;
}) {
  const [role, setRole] = useState(u.role),
    [active, setActive] = useState(u.is_active),
    [ids, setIds] = useState(assigned);
  function reset() {
    setRole(u.role);
    setActive(u.is_active);
    setIds(assigned);
  }
  useEffect(() => {
    setRole(u.role);
    setActive(u.is_active);
    setIds(assigned);
  }, [u.role, u.is_active, assigned.join(",")]);
  return (
    <form
      className="form-panel user-panel admin-editor"
      aria-busy={busy}
      onSubmit={(e) => {
        e.preventDefault();
        if (!busy) void save(role, active, ids);
      }}
    >
      <h2>{u.display_name} · 접근 설정</h2>
      {error && <Alert>{error}</Alert>}
      <fieldset disabled={busy}>
        <fieldset className="admin-assignments">
          <legend>담당 고객사</legend>
          {customers.map((c) => (
            <label className="check" key={c.id}>
              <input
                type="checkbox"
                checked={ids.includes(c.id)}
                onChange={(e) =>
                  setIds((v) =>
                    e.target.checked
                      ? [...v, c.id]
                      : v.filter((id) => id !== c.id),
                  )
                }
              />
              {c.name}
              {!c.is_active && <small>(사용 중지)</small>}
            </label>
          ))}
          {!customers.length && (
            <p className="hint">먼저 고객사를 등록해주세요.</p>
          )}
        </fieldset>
        <label>
          역할
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as Profile["role"])}
          >
            <option value="member">일반 사용자</option>
            <option value="admin">관리자 · 전체 고객사 접근</option>
          </select>
        </label>
        <p className="admin-note">
          {role === "admin"
            ? "관리자는 담당 배정과 관계없이 모든 고객사에 접근합니다. "
            : "일반 사용자는 배정된 고객사에만 접근합니다. "}
          마지막 활성 관리자는 차단하거나 강등할 수 없습니다.
        </p>
        <label className="admin-switch">
          접근 차단
          <input
            type="checkbox"
            checked={!active}
            onChange={(e) => setActive(!e.target.checked)}
          />
          <span aria-hidden="true" />
        </label>
        <div className="form-actions">
          <button type="button" onClick={reset}>
            취소
          </button>
          <button className="primary">{busy ? "저장 중…" : "설정 저장"}</button>
        </div>
        <button className="admin-resend" type="button" onClick={resend}>
          초대 / 비밀번호 설정 링크 재발송
        </button>
      </fieldset>
    </form>
  );
}
