import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import type { Customer, Person, Profile } from "../lib/types";
import { demo, supabase } from "../lib/supabase";
import { getCustomers, getPeople } from "../lib/api";
import { errorMessage } from "../lib/domain";
import {
  isSessionIdle,
  recordSessionActivity,
  sessionActivity,
  watchSessionIdle,
  withSessionLock,
} from "../lib/idleSession";
interface State {
  profile: Profile | null;
  customers: Customer[];
  people: Person[];
  loading: boolean;
  error: string;
  sessionExpired: boolean;
  endingSession: boolean;
  reload: () => Promise<void>;
}
const Context = createContext<State>(null!);
export function SessionProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<Profile | null>(null),
    [customers, setCustomers] = useState<Customer[]>([]),
    [people, setPeople] = useState<Person[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const [sessionExpired, setSessionExpired] = useState(false);
  const [endingSession, setEndingSession] = useState(false);
  const revision = useRef(0);
  const expiring = useRef(false);
  const expire = useCallback((userId: string) => {
    if (expiring.current || !supabase) return;
    const auth = supabase.auth;
    expiring.current = true;
    setEndingSession(true);
    revision.current++;
    setSessionExpired(true);
    setProfile(null);
    setCustomers([]);
    setPeople([]);
    setError("");
    setLoading(false);
    // 이 브라우저의 세션만 종료한다. 네트워크 실패 시에도 SDK가 로컬 인증 정보를 제거한다.
    void withSessionLock(async () => {
      // 다른 탭에서 이미 새로 로그인했다면 이전 만료 요청은 폐기한다.
      const { data } = await auth.getSession();
      if (data.session?.user.id === userId && isSessionIdle(userId))
        await auth.signOut({ scope: "local" });
    }).finally(() => {
      expiring.current = false;
      setEndingSession(false);
    });
  }, []);
  const reload = useCallback(async () => {
    const current = revision.current;
    try {
      setError("");
      if (demo) {
        setProfile({
          id: "demo",
          display_name: "포트폴리오 방문자",
          email: "",
          role: "member",
          is_active: true,
        });
        setCustomers(await getCustomers());
        setPeople(await getPeople());
        return;
      }
      if (!supabase) return;
      const { data, error } = await supabase.auth.getUser();
      if (current !== revision.current) return;
      if (error) {
        if (error.name === "AuthSessionMissingError") {
          setProfile(null);
          return;
        }
        throw error;
      }
      if (!data.user) {
        setProfile(null);
        return;
      }
      if (isSessionIdle(data.user.id)) {
        expire(data.user.id);
        return;
      }
      if (!sessionActivity(data.user.id)) recordSessionActivity(data.user.id);
      const result = await supabase
        .from("profiles")
        .select("*")
        .eq("id", data.user.id)
        .single();
      if (result.error) throw result.error;
      let c: Customer[] = [],
        p: Person[] = [];
      if (result.data.is_active) {
        [c, p] = await Promise.all([getCustomers(), getPeople()]);
      }
      if (current !== revision.current) return;
      if (isSessionIdle(data.user.id)) {
        expire(data.user.id);
        return;
      }
      setSessionExpired(false);
      setProfile(result.data);
      setCustomers(c);
      setPeople(p);
    } catch (e) {
      if (current === revision.current) setError(errorMessage(e));
    } finally {
      if (current === revision.current) setLoading(false);
    }
  }, [expire]);
  useEffect(() => {
    if (!demo && profile)
      return watchSessionIdle(profile.id, () => expire(profile.id));
  }, [profile?.id, expire]);
  useEffect(() => {
    void reload();
    const { data } = supabase?.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT" || event === "SIGNED_IN") revision.current++;
      setTimeout(() => void reload(), 0);
    }) ?? { data: null };
    const visible = () => {
      if (document.visibilityState === "visible") void reload();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      data?.subscription.unsubscribe();
      document.removeEventListener("visibilitychange", visible);
    };
  }, [reload]);
  return (
    <Context.Provider
      value={{
        profile,
        customers,
        people,
        loading,
        error,
        sessionExpired,
        endingSession,
        reload,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export const useSession = () => useContext(Context);
