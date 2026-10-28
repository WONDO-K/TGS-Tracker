import { useState } from "react";
import type { ReactNode } from "react";
import {
  HashRouter,
  Link,
  NavLink,
  Navigate,
  Outlet,
  Route,
  Routes,
} from "react-router-dom";
import { SessionProvider, useSession } from "./Session";
import { AuthPage } from "../features/auth/AuthPage";
import { Board } from "../features/requests/Board";
import { NewRequest } from "../features/requests/NewRequest";
import { RequestDetail } from "../features/requests/RequestDetail";
import { Customers, Users } from "../features/admin/Admin";
import { Alert, Loading } from "../components/UI";
import { client, configured, demo } from "../lib/supabase";
import { errorMessage } from "../lib/domain";
import { rpc } from "../lib/api";
export function App({ authError = "" }: { authError?: string }) {
  if (!demo && !configured)
    return (
      <main className="setup">
        <span className="brand-mark">T</span>
        <h1>TGS Tracker</h1>
        <p>서비스 연결 설정이 필요합니다.</p>
        <p>
          프로젝트의 README와 .env.example에 따라 Supabase 연결값을
          설정해주세요.
        </p>
        <code>npm run dev -- --mode demo</code>
        <small>가상 데이터 화면은 위 명령으로 확인할 수 있습니다.</small>
      </main>
    );
  return (
    <HashRouter>
      <SessionProvider>
        <Routes>
          <Route
            path="/login"
            element={<AuthPage initialError={authError} />}
          />
          <Route path="/reset-password" element={<AuthPage mode="reset" />} />
          <Route
            path="/set-password"
            element={<AuthPage mode="set" initialError={authError} />}
          />
          <Route element={<Guard />}>
            <Route element={<Layout />}>
              <Route path="/board" element={<Board />} />
              <Route path="/requests" element={<Board list />} />
              <Route path="/requests/:id" element={<RequestDetail />} />
              <Route
                path="/account"
                element={demo ? <Navigate to="/board" /> : <Account />}
              />
              <Route
                path="/requests/new"
                element={demo ? <Navigate to="/board" /> : <NewRequest />}
              />
              <Route
                path="/admin/customers"
                element={
                  <AdminGuard>
                    <Customers />
                  </AdminGuard>
                }
              />
              <Route
                path="/admin/users"
                element={
                  <AdminGuard>
                    <Users />
                  </AdminGuard>
                }
              />
              <Route path="*" element={<Navigate to="/board" replace />} />
            </Route>
          </Route>
        </Routes>
      </SessionProvider>
    </HashRouter>
  );
}
function Guard() {
  const { profile, loading, error, reload } = useSession();
  if (loading) return <Loading />;
  if (error)
    return (
      <main className="setup">
        <Alert>{error}</Alert>
        <button onClick={() => void reload()}>다시 시도</button>
        <button onClick={() => void client().auth.signOut()}>로그아웃</button>
      </main>
    );
  if (!profile) return <Navigate to="/login" replace />;
  if (!profile.is_active)
    return (
      <main className="setup">
        <h1>접근이 제한된 계정입니다.</h1>
        <p>관리자에게 계정 활성화를 요청해주세요.</p>
        <button onClick={() => void client().auth.signOut()}>로그아웃</button>
      </main>
    );
  return <Outlet />;
}
function AdminGuard({ children }: { children: ReactNode }) {
  const { profile } = useSession();
  return !demo && profile?.role === "admin" ? (
    children
  ) : (
    <Navigate to="/board" replace />
  );
}
function Layout() {
  const { profile, customers } = useSession();
  const links = (
    <>
      <NavLink to="/board">진행 현황</NavLink>
      <NavLink to="/requests">요청 목록</NavLink>
      {!demo && profile?.role === "admin" && (
        <>
          <NavLink to="/admin/customers">고객사 관리</NavLink>
          <NavLink to="/admin/users">사용자 관리</NavLink>
        </>
      )}
    </>
  );
  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="header-inner">
          <Link to="/board" className="brand">
            <svg viewBox="0 0 30 24" width="30" height="24" aria-hidden="true">
              <path
                d="M2 4h9v8h9M2 12h5v8h20M20 8l4 4-4 4"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinejoin="round"
              />
            </svg>
            <span>
              TGS <strong>Tracker</strong>
            </span>
          </Link>
          <nav className="desktop-nav" aria-label="주 메뉴">
            {links}
          </nav>
          <div className="header-account">
            {demo ? (
              <span className="demo-label">체험용 데이터</span>
            ) : (
              <>
                <Link to="/account">{profile?.display_name}</Link>
                <button
                  className="quiet"
                  onClick={() => void client().auth.signOut()}
                >
                  로그아웃
                </button>
              </>
            )}
          </div>
          <details className="mobile-menu">
            <summary>메뉴</summary>
            <nav
              aria-label="모바일 메뉴"
              onClick={(e) => {
                if ((e.target as HTMLElement).closest("a"))
                  e.currentTarget.closest("details")!.open = false;
              }}
            >
              {links}
              {!demo && (
                <>
                  <Link to="/account">내 계정</Link>
                  <button onClick={() => void client().auth.signOut()}>
                    로그아웃
                  </button>
                </>
              )}
            </nav>
          </details>
        </div>
      </header>
      <div className="main-area">
        <main className="page-content">
          {!demo && !customers.length && profile?.role !== "admin" && (
            <Alert tone="info">
              담당 고객사 배정이 필요합니다. 관리자에게 문의해주세요.
            </Alert>
          )}
          <Outlet />
        </main>
        <footer className="site-footer">
          <span>TGS Tracker · 고객사 요청·조치·배포 관리</span>
          <span>{demo ? "가상 데이터 / 읽기 전용" : "TGS 내부 업무"}</span>
        </footer>
      </div>
    </div>
  );
}
function Account() {
  const { profile, reload } = useSession();
  const [name, setName] = useState(profile?.display_name || ""),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  return (
    <section className="form-panel account-panel">
      <h1>내 계정</h1>
      <p className="muted">{profile?.email}</p>
      {error && <Alert>{error}</Alert>}
      {message && <Alert tone="success">{message}</Alert>}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setError("");
          try {
            await rpc("update_display_name", { name });
            await reload();
            setMessage("이름을 저장했습니다.");
          } catch (e) {
            setError(errorMessage(e));
          }
        }}
      >
        <label>
          표시 이름
          <input
            required
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <button className="primary">이름 저장</button>
        <Link className="text-link" to="/set-password">
          비밀번호 변경
        </Link>
      </form>
    </section>
  );
}
