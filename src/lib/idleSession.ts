export const IDLE_TIMEOUT = 30 * 60 * 1000;
const activityKey = (userId: string) => `tgs-tracker:last-activity:${userId}`;

// 다른 탭에서 늦게 끝난 로그아웃이 새 로그인 세션을 지우지 않도록 순서를 맞춘다.
export function withSessionLock<T>(operation: () => Promise<T>): Promise<T> {
  return navigator.locks
    ? navigator.locks.request("tgs-tracker:auth-operation", operation)
    : operation();
}

export function sessionActivity(userId: string) {
  const value = Number(localStorage.getItem(activityKey(userId)));
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function recordSessionActivity(userId: string) {
  localStorage.setItem(activityKey(userId), String(Date.now()));
}

export function isSessionIdle(userId: string) {
  const last = sessionActivity(userId);
  return last > 0 && Date.now() - last >= IDLE_TIMEOUT;
}

export function watchSessionIdle(userId: string, expire: () => void) {
  let timer: ReturnType<typeof setTimeout>;
  let expired = false;
  if (!sessionActivity(userId)) recordSessionActivity(userId);
  const check = () => {
    clearTimeout(timer);
    if (expired) return false;
    if (isSessionIdle(userId)) {
      expired = true;
      expire();
      return false;
    }
    timer = setTimeout(
      check,
      Math.max(1, IDLE_TIMEOUT - (Date.now() - sessionActivity(userId))),
    );
    return true;
  };
  const activity = (event: Event) => {
    if (!event.isTrusted || !check()) return;
    // 마우스 이동마다 저장하지 않고, 최대 1초 간격으로 다른 탭과 활동 시각을 공유한다.
    if (Date.now() - sessionActivity(userId) >= 1000) {
      recordSessionActivity(userId);
      check();
    }
  };
  const visible = () => {
    if (document.visibilityState === "visible") check();
  };
  const storage = (event: StorageEvent) => {
    if (event.key === activityKey(userId)) check();
  };
  const events = [
    "pointerdown",
    "pointermove",
    "keydown",
    "wheel",
    "touchstart",
  ];
  events.forEach((name) =>
    document.addEventListener(name, activity, { passive: true, capture: true }),
  );
  document.addEventListener("visibilitychange", visible);
  window.addEventListener("focus", visible);
  window.addEventListener("pageshow", visible);
  window.addEventListener("storage", storage);
  check();
  return () => {
    expired = true;
    clearTimeout(timer);
    events.forEach((name) =>
      document.removeEventListener(name, activity, true),
    );
    document.removeEventListener("visibilitychange", visible);
    window.removeEventListener("focus", visible);
    window.removeEventListener("pageshow", visible);
    window.removeEventListener("storage", storage);
  };
}
