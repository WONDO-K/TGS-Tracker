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
import { Brand } from "../components/Brand";
import { ConfirmProvider } from "../components/Confirm";
export function App({ authError = "" }: { authError?: string }) {
  const [callbackError, setCallbackError] = useState(authError);
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
        <ConfirmProvider>
          <Routes>
            <Route
              path="/login"
              element={
                <AuthPage
                  initialError={callbackError}
                  onDismissError={() => setCallbackError("")}
                />
              }
            />
            <Route path="/reset-password" element={<AuthPage mode="reset" />} />
            <Route
              path="/set-password"
              element={
                <AuthPage
                  mode="set"
                  initialError={callbackError}
                  onDismissError={() => setCallbackError("")}
                />
              }
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
                <Route index element={<Navigate to="/board" replace />} />
                <Route
                  path="*"
                  element={
                    <section className="form-panel">
                      <h1>페이지를 찾을 수 없습니다</h1>
                      <p>주소가 변경되었거나 사용할 수 없는 화면입니다.</p>
                      <Link className="button primary" to="/board">
                        진행 현황으로 이동
                      </Link>
                    </section>
                  }
                />
              </Route>
            </Route>
          </Routes>
        </ConfirmProvider>
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
  const mainLinks = (
    <>
      <NavLink to="/board">진행 현황</NavLink>
      <NavLink to="/requests" end>
        요청 목록
      </NavLink>
    </>
  );
  const adminLinks =
    !demo && profile?.role === "admin" ? (
      <>
        <Link to="/requests?archived=true">보관함</Link>
        <NavLink to="/admin/customers">고객사 관리</NavLink>
        <NavLink to="/admin/users">사용자 관리</NavLink>
      </>
    ) : null;
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Brand />
        <p className="nav-label">업무</p>
        <nav aria-label="주 메뉴">{mainLinks}</nav>
        {adminLinks && (
          <>
            <p className="nav-label">관리자</p>
            <nav aria-label="관리자 메뉴">{adminLinks}</nav>
          </>
        )}
        <div className="sidebar-foot">
          <div className="customer-scope">
            <small>접근 가능한 고객사</small>
            <strong>{customers.length}곳</strong>
          </div>
          <div className="sidebar-person">
            <span className="avatar">{profile?.display_name.slice(0, 1)}</span>
            <div>
              <strong>{profile?.display_name}</strong>
              <small>
                {demo
                  ? "읽기 전용 데모"
                  : profile?.role === "admin"
                    ? "관리자"
                    : "팀 멤버"}
              </small>
            </div>
          </div>
          {!demo && (
            <div className="sidebar-account">
              <Link to="/account">내 계정</Link>
              <button
                className="quiet"
                onClick={() => void client().auth.signOut()}
              >
                로그아웃
              </button>
            </div>
          )}
        </div>
      </aside>
      <header className="mobile-shell">
        <Brand />
        <span>{demo ? "읽기 전용 데모" : "TGS 업무"}</span>
      </header>
      <div className="main-area">
        <main className="page-content">
          {!demo && !customers.length && profile?.role !== "admin" && (
            <Alert tone="info">
              담당 고객사 배정이 필요합니다. 관리자에게 문의해주세요.
            </Alert>
          )}
          {demo && (
            <div className="demo-banner">
              포트폴리오 데모 <span>가상 데이터 · 읽기 전용</span>
            </div>
          )}
          <Outlet />
        </main>
        <footer className="site-footer">
          <span>TGS Tracker · 고객사 요청·조치·배포 관리</span>
          <span>{demo ? "가상 데이터 / 읽기 전용" : "TGS 내부 업무"}</span>
        </footer>
      </div>
      <div className="bottom-nav">
        <NavLink to="/board">현황</NavLink>
        <NavLink to="/requests" end>
          목록
        </NavLink>
        {!demo && <NavLink to="/requests/new">요청 등록</NavLink>}
        <details className="mobile-menu">
          <summary>메뉴</summary>
          <nav
            aria-label="모바일 메뉴"
            onClick={(e) => {
              if ((e.target as HTMLElement).closest("a"))
                e.currentTarget.closest("details")!.open = false;
            }}
          >
            {mainLinks}
            {adminLinks}
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
