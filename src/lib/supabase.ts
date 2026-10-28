import { createClient } from "@supabase/supabase-js";
export const demo = import.meta.env.VITE_APP_MODE === "demo";
const url = import.meta.env.VITE_SUPABASE_URL,
  key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
export const configured = Boolean(
  url && key && !url.includes("YOUR_PROJECT") && !key.includes("YOUR_"),
);
export const supabase =
  !demo && configured
    ? createClient(url, key, {
        auth: { detectSessionInUrl: false, flowType: "pkce" },
      })
    : null;
export function client() {
  if (!supabase)
    throw new Error(
      "Supabase 연결 설정이 필요합니다. .env.example과 README를 확인해주세요.",
    );
  return supabase;
}
export function callbackUrl() {
  return new URL(import.meta.env.BASE_URL, window.location.origin).href;
}
