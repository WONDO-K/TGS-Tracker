import { useEffect, useState } from "react";
import { Brand } from "../../components/Brand";
import { Link, useNavigate } from "react-router-dom";
import { client, callbackUrl, demo } from "../../lib/supabase";
import { errorMessage } from "../../lib/domain";
import { Alert } from "../../components/UI";
import { useSession } from "../../app/Session";
import "./auth.css";

export function AuthPage({
  mode = "login",
  initialError = "",
  onDismissError,
}: {
  mode?: "login" | "reset" | "set";
  initialError?: string;
  onDismissError?: () => void;
}) {
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [confirm, setConfirm] = useState(""),
    [visible, setVisible] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [fields, setFields] = useState<Record<string, string>>({});
  const navigate = useNavigate(),
    { reload } = useSession();
  const linkError = mode !== "reset" && Boolean(initialError);
  useEffect(() => {
    setFields({});
    setError("");
    setMessage("");
    setPassword("");
    setConfirm("");
    setVisible(false);
  }, [mode]);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy || demo) return;
    setError("");
    setMessage("");
    const invalid: Record<string, string> = {};
    const emailInput = e.currentTarget.elements.namedItem(
      "email",
    ) as HTMLInputElement | null;
    if (mode !== "set" && (!email.trim() || emailInput?.validity.typeMismatch))
      invalid.email = "올바른 이메일 주소를 입력해 주세요.";
    if (mode !== "reset" && password.length < (mode === "set" ? 10 : 1))
      invalid.password =
        mode === "set"
          ? "비밀번호를 10자 이상 입력해 주세요."
          : "비밀번호를 입력해 주세요.";
    if (mode === "set" && (!confirm || password !== confirm))
      invalid.confirm = "비밀번호가 일치하지 않습니다.";
    setFields(invalid);
    const first = Object.keys(invalid)[0];
    if (first) {
      (e.currentTarget.elements.namedItem(first) as HTMLInputElement).focus();
      return;
    }
    setBusy(true);
    try {
      const auth = client().auth;
      if (mode === "reset") {
        const { error } = await auth.resetPasswordForEmail(email.trim(), {
          redirectTo: callbackUrl(),
        });
        if (error) throw error;
        setMessage(
          "등록된 계정이라면 비밀번호 재설정 메일이 발송됩니다. 메일함과 스팸함을 확인해 주세요.",
        );
      } else if (mode === "set") {
        const { error } = await auth.updateUser({ password });
        if (error) throw error;
        await reload();
        setPassword("");
        setConfirm("");
        setMessage(
          "비밀번호가 저장되었습니다. 이제 TGS Tracker를 이용할 수 있습니다.",
        );
      } else {
        const { error } = await auth.signInWithPassword({
          email: email.trim(),
          password,
        });
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
  const title = linkError
    ? "인증 링크를 사용할 수 없습니다"
    : mode === "login"
      ? "로그인"
      : mode === "reset"
        ? "비밀번호 재설정"
        : "비밀번호 설정";
  return (
    <main className="auth-shell auth-complete">
      <section className="auth-story" aria-label="TGS Tracker 소개">
        <Brand />
        <div className="auth-intro">
          <h2>고객 요청부터 운영 반영까지, 한 화면에서.</h2>
          <p>
            접수된 요청의 진행 상태와 테스트·운영 반영 여부를 팀이 함께
            확인합니다. 운영에 빠진 건은 바로 찾을 수 있습니다.
          </p>
        </div>
        <ol className="auth-stage-preview" aria-label="요청 처리 흐름">
          <li>
            <span>접수</span>
            <p>고객 요청 기록</p>
          </li>
          <li>
            <span>조치중</span>
            <p>담당자와 조치 공유</p>
          </li>
          <li>
            <span>검증</span>
            <p>테스트 반영 확인</p>
          </li>
          <li>
            <span>완료</span>
            <p>업무 처리 완료</p>
          </li>
        </ol>
        <p className="auth-stage-note">
          업무 완료와 운영 반영은 별도로 확인합니다.
        </p>
      </section>
      <section className="auth-form" aria-labelledby="auth-title">
        <div className="auth-mobile-brand">
          <Brand />
        </div>
        <h1 id="auth-title">{title}</h1>
        <p>
          {linkError
            ? "초대 또는 비밀번호 재설정 링크가 만료되었거나 이미 사용되었습니다."
            : mode === "login"
              ? "초대받은 이메일 계정으로 로그인하세요."
              : mode === "reset"
                ? "가입한 이메일로 재설정 링크를 보내드립니다."
                : "사용할 새 비밀번호를 입력하세요."}
        </p>
        {linkError ? (
          <div className="auth-result">
            <Alert>{initialError}</Alert>
            <p>
              처음 초대받았다면 관리자에게 초대 재발송을 요청해 주세요. 기존
              계정은 비밀번호 재설정 메일을 받을 수 있습니다.
            </p>
            <Link
              className="primary button wide"
              to="/reset-password"
              onClick={onDismissError}
            >
              비밀번호 재설정
            </Link>
            <Link className="text-link" to="/login" onClick={onDismissError}>
              로그인으로 돌아가기
            </Link>
          </div>
        ) : demo ? (
          <div className="auth-result">
            <Alert tone="info">
              읽기 전용 데모에서는 계정 로그인을 제공하지 않습니다.
            </Alert>
            <Link className="primary button wide" to="/board">
              데모 둘러보기
            </Link>
          </div>
        ) : (
          <>
            {error && <Alert>{error}</Alert>}
            {message && <Alert tone="success">{message}</Alert>}
            {message ? (
              <div className="auth-result">
                <Link
                  className="primary button wide"
                  to={mode === "set" ? "/board" : "/login"}
                >
                  {mode === "set"
                    ? "진행 현황으로 이동"
                    : "로그인으로 돌아가기"}
                </Link>
                {mode === "reset" && (
                  <button
                    type="button"
                    className="text-link"
                    onClick={() => setMessage("")}
                  >
                    이메일 주소 다시 입력
                  </button>
                )}
              </div>
            ) : (
              <>
                <form onSubmit={submit} noValidate aria-busy={busy}>
                  {mode !== "set" && (
                    <div className="auth-field">
                      <label htmlFor="auth-email">이메일</label>
                      <input
                        id="auth-email"
                        name="email"
                        autoComplete="email"
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                        maxLength={254}
                        placeholder="name@company.com"
                        aria-invalid={Boolean(fields.email)}
                        aria-describedby={
                          fields.email ? "auth-email-error" : undefined
                        }
                        disabled={busy}
                      />
                      {fields.email && (
                        <p
                          id="auth-email-error"
                          className="auth-field-error"
                          role="alert"
                        >
                          {fields.email}
                        </p>
                      )}
                    </div>
                  )}
                  {mode !== "reset" && (
                    <div className="auth-field">
                      <label htmlFor="auth-password">
                        {mode === "set" ? "새 비밀번호" : "비밀번호"}
                      </label>
                      <div className="auth-password-control">
                        <input
                          id="auth-password"
                          name="password"
                          autoComplete={
                            mode === "set" ? "new-password" : "current-password"
                          }
                          type={visible ? "text" : "password"}
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          minLength={mode === "set" ? 10 : 1}
                          required
                          placeholder={
                            mode === "set" ? "10자 이상 입력" : "비밀번호 입력"
                          }
                          aria-invalid={Boolean(fields.password)}
                          aria-describedby={
                            [
                              mode === "set" ? "auth-password-hint" : "",
                              fields.password ? "auth-password-error" : "",
                            ]
                              .filter(Boolean)
                              .join(" ") || undefined
                          }
                          disabled={busy}
                        />
                        <button
                          type="button"
                          onClick={() => setVisible(!visible)}
                          aria-label={
                            visible ? "비밀번호 숨기기" : "비밀번호 표시"
                          }
                          aria-pressed={visible}
                        >
                          {visible ? "숨김" : "표시"}
                        </button>
                      </div>
                      {mode === "set" && (
                        <p id="auth-password-hint" className="auth-field-hint">
                          비밀번호는 10자 이상으로 설정해 주세요.
                        </p>
                      )}
                      {fields.password && (
                        <p
                          id="auth-password-error"
                          className="auth-field-error"
                          role="alert"
                        >
                          {fields.password}
                        </p>
                      )}
                    </div>
                  )}
                  {mode === "set" && (
                    <div className="auth-field">
                      <label htmlFor="auth-confirm">비밀번호 확인</label>
                      <input
                        id="auth-confirm"
                        name="confirm"
                        type={visible ? "text" : "password"}
                        autoComplete="new-password"
                        value={confirm}
                        onChange={(e) => setConfirm(e.target.value)}
                        minLength={10}
                        required
                        placeholder="새 비밀번호 다시 입력"
                        aria-invalid={Boolean(fields.confirm)}
                        aria-describedby={
                          fields.confirm ? "auth-confirm-error" : undefined
                        }
                        disabled={busy}
                      />
                      {fields.confirm && (
                        <p
                          id="auth-confirm-error"
                          className="auth-field-error"
                          role="alert"
                        >
                          {fields.confirm}
                        </p>
                      )}
                    </div>
                  )}
                  {mode === "login" && (
                    <Link
                      className="text-link auth-reset-link"
                      to="/reset-password"
                    >
                      비밀번호 재설정
                    </Link>
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
                {mode !== "login" && (
                  <Link className="text-link" to="/login">
                    로그인으로 돌아가기
                  </Link>
                )}
              </>
            )}
          </>
        )}
        <div className="auth-note">
          계정은 관리자 초대로만 만들어집니다. 로그인 후 담당 고객사가 보이지
          않으면 관리자에게 배정을 요청해 주세요.
        </div>
        <footer className="auth-footer">
          © TGS Tracker · 내부 업무용 시스템
        </footer>
      </section>
    </main>
  );
}
