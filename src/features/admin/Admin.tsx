import { useCallback, useEffect, useState } from "react";
import { useSession } from "../../app/Session";
import { client } from "../../lib/supabase";
import { rpc } from "../../lib/api";
import { errorMessage } from "../../lib/domain";
import type { Customer, Profile } from "../../lib/types";
import { Alert, Loading, PageTitle } from "../../components/UI";
export function Customers() {
  const { customers, reload } = useSession();
  const [form, setForm] = useState({
      id: "",
      name: "",
      code: "",
      is_active: true,
    }),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await rpc("save_customer", { ...form, id: form.id || null });
      await reload();
      setForm({ id: "", name: "", code: "", is_active: true });
      setMessage("고객사 정보를 저장했습니다.");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageTitle
        eyebrow="ADMINISTRATION"
        title="고객사 관리"
        description="고객사를 등록하고 사용 상태를 관리합니다."
      />
      {error && <Alert>{error}</Alert>}
      {message && <Alert tone="success">{message}</Alert>}
      <div className="admin-grid">
        <section className="form-panel">
          <h2>{form.id ? "고객사 수정" : "고객사 등록"}</h2>
          <form onSubmit={submit}>
            <label>
              고객사명
              <input
                required
                maxLength={80}
                value={form.name}
                onChange={(e) =>
                  setForm((f) => ({ ...f, name: e.target.value }))
                }
              />
            </label>
            <label>
              고객사 코드
              <input
                required
                pattern="[A-Za-z0-9_-]{1,20}"
                maxLength={20}
                value={form.code}
                onChange={(e) =>
                  setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))
                }
                placeholder="영문·숫자·밑줄·하이픈"
              />
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={(e) =>
                  setForm((f) => ({ ...f, is_active: e.target.checked }))
                }
              />
              사용 중
            </label>
            <p className="hint">
              사용을 중지해도 기록은 보존되며 기존 담당자는 읽기만 가능합니다.
            </p>
            <div className="form-actions">
              {form.id && (
                <button
                  type="button"
                  onClick={() =>
                    setForm({ id: "", name: "", code: "", is_active: true })
                  }
                >
                  취소
                </button>
              )}
              <button className="primary" disabled={busy}>
                저장
              </button>
            </div>
          </form>
        </section>
        <section className="table-wrap">
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
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td>
                    <code>{c.code}</code>
                  </td>
                  <td>
                    <span
                      className={`status-pill ${c.is_active ? "completed" : "received"}`}
                    >
                      {c.is_active ? "사용 중" : "사용 중지"}
                    </span>
                  </td>
                  <td>
                    <button
                      onClick={() => {
                        setForm(c);
                        setMessage("");
                      }}
                    >
                      수정
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!customers.length && (
            <p className="empty">첫 고객사를 등록해주세요.</p>
          )}
        </section>
      </div>
    </>
  );
}
interface Member {
  customer_id: string;
  user_id: string;
}
export function Users() {
  const { customers, reload } = useSession();
  const [users, setUsers] = useState<Profile[]>([]),
    [members, setMembers] = useState<Member[]>([]),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [email, setEmail] = useState(""),
    [name, setName] = useState("");
  const load = useCallback(async () => {
    try {
      const [u, m] = await Promise.all([
        client().from("profiles").select("*").order("created_at"),
        client().from("customer_members").select("customer_id,user_id"),
      ]);
      if (u.error) throw u.error;
      if (m.error) throw m.error;
      setUsers(u.data);
      setMembers(m.data);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  async function run(action: () => Promise<void>, success: string) {
    setError("");
    setMessage("");
    setBusy(true);
    try {
      await action();
      await load();
      await reload();
      setMessage(success);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function invite(e: React.FormEvent) {
    e.preventDefault();
    await run(async () => {
      const { data, error } = await client().functions.invoke("invite-user", {
        body: { email, display_name: name },
      });
      if (error) {
        let message = "초대 발송 실패";
        try {
          message = (await error.context.json()).error || message;
        } catch {
          /* SDK 기본 오류로 대체 */
        }
        throw new Error(message);
      }
      if (data?.error) throw new Error(data.error);
      setEmail("");
      setName("");
    }, "초대 또는 비밀번호 설정 메일을 발송했습니다. 담당 고객사도 배정해주세요.");
  }
  return (
    <>
      <PageTitle
        eyebrow="ADMINISTRATION"
        title="사용자 관리"
        description="동료를 초대하고 담당 고객사와 접근 권한을 지정하세요."
      />
      {error && <Alert>{error}</Alert>}
      {message && <Alert tone="success">{message}</Alert>}
      <section className="form-panel">
        <h2>동료 초대 / 설정 링크 재발송</h2>
        <form onSubmit={invite} className="invite-form">
          <label>
            이름
            <input
              required
              maxLength={80}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="홍길동"
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
          <button className="primary" disabled={busy}>
            초대 발송
          </button>
        </form>
        <p className="hint">
          기존 계정에는 비밀번호 재설정 링크를 발송하며 역할·담당 고객사는
          유지합니다.
        </p>
      </section>
      {loading ? (
        <Loading />
      ) : (
        <div className="user-list">
          {users.map((u) => (
            <UserEditor
              key={u.id}
              user={u}
              customers={customers}
              assigned={members
                .filter((m) => m.user_id === u.id)
                .map((m) => m.customer_id)}
              busy={busy}
              save={(role, is_active, ids) =>
                run(async () => {
                  if (role !== u.role || is_active !== u.is_active)
                    await rpc("set_user_access", {
                      user_id: u.id,
                      role,
                      is_active,
                    });
                  await rpc("set_customer_members", {
                    user_id: u.id,
                    customer_ids: ids,
                  });
                }, "사용자 설정을 저장했습니다.")
              }
            />
          ))}
        </div>
      )}
    </>
  );
}
function UserEditor({
  user: u,
  customers,
  assigned,
  busy,
  save,
}: {
  user: Profile;
  customers: Customer[];
  assigned: string[];
  busy: boolean;
  save: (role: string, active: boolean, ids: string[]) => Promise<void>;
}) {
  const [role, setRole] = useState(u.role),
    [active, setActive] = useState(u.is_active),
    [ids, setIds] = useState(assigned);
  useEffect(() => {
    setRole(u.role);
    setActive(u.is_active);
    setIds(assigned);
  }, [u.role, u.is_active, assigned.join(",")]);
  return (
    <form
      className="user-panel"
      onSubmit={(e) => {
        e.preventDefault();
        if (
          role === "admin" &&
          u.role !== "admin" &&
          !window.confirm(
            "관리자는 모든 고객사 자료에 접근하고 사용자 권한을 변경할 수 있습니다. 승격할까요?",
          )
        )
          return;
        void save(role, active, ids);
      }}
    >
      <header>
        <span className="avatar">{u.display_name.slice(0, 1)}</span>
        <div>
          <strong>{u.display_name}</strong>
          <small>{u.email}</small>
        </div>
        <span
          className={`status-pill ${u.is_active ? "completed" : "received"}`}
        >
          {u.is_active ? "활성" : "접근 차단"}
        </span>
      </header>
      <div className="form-grid">
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
        <label className="check">
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
          />
          시스템 접근 허용
        </label>
      </div>
      <div className="section-label">담당 고객사</div>
      <div className="member-checks">
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
            {!c.is_active ? " (사용 중지)" : ""}
          </label>
        ))}
        {!customers.length && (
          <span className="muted">먼저 고객사를 등록해주세요.</span>
        )}
      </div>
      {role === "admin" && (
        <p className="hint">
          관리자는 담당 배정과 관계없이 전체 고객사에 접근합니다.
        </p>
      )}
      <div className="form-actions">
        <button disabled={busy}>설정 저장</button>
      </div>
    </form>
  );
}
