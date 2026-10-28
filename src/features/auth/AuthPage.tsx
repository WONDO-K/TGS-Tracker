import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { client, callbackUrl } from "../../lib/supabase";
import { errorMessage } from "../../lib/domain";
import { Alert } from "../../components/UI";
import { useSession } from "../../app/Session";
export function AuthPage({
  mode = "login",
  initialError = "",
}: {
  mode?: "login" | "reset" | "set";
  initialError?: string;
}) {
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [confirm, setConfirm] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(initialError),
    [message, setMessage] = useState("");
  const navigate = useNavigate(),
    { reload } = useSession();
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setMessage("");
    setBusy(true);
    try {
      const auth = client().auth;
      if (mode === "reset") {
        const { error } = await auth.resetPasswordForEmail(email, {
          redirectTo: callbackUrl(),
        });
        if (error) throw error;
        setMessage("등록된 계정이라면 비밀번호 재설정 메일이 발송됩니다.");
      } else if (mode === "set") {
        if (password !== confirm)
          throw new Error("비밀번호가 일치하지 않습니다.");
        const { error } = await auth.updateUser({ password });
        if (error) throw error;
        await reload();
        navigate("/board", { replace: true });
      } else {
        const { error } = await auth.signInWithPassword({ email, password });
        if (error) throw error;
        await reload();
        navigate("/board", { replace: true });
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-shell">
      <section className="auth-story">
        <Link className="brand" to="/">
          <span className="brand-mark">T</span>
          <span>
            TGS <strong>Tracker</strong>
          </span>
        </Link>
        <div>
          <span className="eyebrow">FROM REQUEST TO RELEASE</span>
          <h1>
            요청의 시작부터
            <br />
            운영 반영까지.
          </h1>
          <p>
            흩어진 요청과 조치 기록을 한곳에.
            <br />
            함께 확인하고, 빠짐없이 마무리하세요.
          </p>
          <div className="auth-flow">
            <span>접수</span>
            <i>→</i>
            <span>조치</span>
            <i>→</i>
            <span>운영 반영 ✓</span>
          </div>
        </div>
        <small>TGS · Internal workspace</small>
      </section>
      <section className="auth-form">
        <div className="eyebrow">TGS WORKSPACE</div>
        <h2>
          {mode === "login"
            ? "다시 만나 반갑습니다"
            : mode === "reset"
              ? "비밀번호 재설정"
              : "비밀번호 설정"}
        </h2>
        <p>
          {mode === "login"
            ? "초대받은 회사 계정으로 로그인하세요."
            : mode === "reset"
              ? "가입한 이메일로 재설정 링크를 보내드립니다."
              : "사용할 새 비밀번호를 입력하세요."}
        </p>
        {error && <Alert>{error}</Alert>}
        {message && <Alert tone="success">{message}</Alert>}
        <form onSubmit={submit}>
          {mode !== "set" && (
            <label>
              이메일
              <input
                autoComplete="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                maxLength={254}
                placeholder="name@company.com"
              />
            </label>
          )}
          {mode !== "reset" && (
            <label>
              비밀번호
              <input
                autoComplete={
                  mode === "set" ? "new-password" : "current-password"
                }
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={mode === "set" ? 10 : 1}
                required
                placeholder={
                  mode === "set" ? "10자 이상 입력" : "비밀번호 입력"
                }
              />
            </label>
          )}
          {mode === "set" && (
            <label>
              비밀번호 확인
              <input
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                minLength={10}
                required
              />
            </label>
          )}
          <button className="primary wide" disabled={busy}>
            {busy
              ? "처리 중…"
              : mode === "login"
                ? "로그인"
                : mode === "reset"
                  ? "재설정 메일 보내기"
                  : "비밀번호 저장"}
          </button>
        </form>
        <Link
          className="text-link"
          to={mode === "login" ? "/reset-password" : "/login"}
        >
          {mode === "login" ? "비밀번호를 잊으셨나요?" : "로그인으로 돌아가기"}
        </Link>
        <div className="auth-note">
          TGS Tracker는 초대받은 사용자만 이용할 수 있습니다.
        </div>
      </section>
    </main>
  );
}
