const bytes64 = (value: Uint8Array) => btoa(String.fromCharCode(...value));
const base64url = (value: Uint8Array) =>
  bytes64(value).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
const random = () => base64url(crypto.getRandomValues(new Uint8Array(32)));
export async function hashState(value: string) {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
  ]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
export async function makeOAuthRequest(clientId: string, callbackUrl: string) {
  const state = random(),
    verifier = random();
  const challenge = base64url(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
    ),
  );
  const url = new URL("https://github.com/login/oauth/authorize");
  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: callbackUrl,
    scope: "repo",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    allow_signup: "false",
  }).toString();
  return { state, verifier, url: url.href };
}
async function encryptionKey(encoded: string) {
  const value = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
  if (value.length !== 32)
    throw new Error("GitHub 토큰 암호화 설정을 확인해주세요.");
  return crypto.subtle.importKey("raw", value, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}
export function validTokenKey(encoded: string) {
  try {
    return atob(encoded).length === 32;
  } catch {
    return false;
  }
}
export async function encryptToken(value: string, key: string, userId: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(userId) },
    await encryptionKey(key),
    new TextEncoder().encode(value),
  );
  return `${bytes64(iv)}.${bytes64(new Uint8Array(encrypted))}`;
}
export async function decryptToken(value: string, key: string, userId: string) {
  const parts = value.split(".");
  if (parts.length !== 2)
    throw new Error("GitHub 연결 정보를 다시 설정해주세요.");
  const decode = (data: string) =>
    Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
  const clear = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: decode(parts[0]),
      additionalData: new TextEncoder().encode(userId),
    },
    await encryptionKey(key),
    decode(parts[1]),
  );
  return new TextDecoder().decode(clear);
}
export function allowedReturnUrl(value: unknown, allowed: string[]) {
  if (typeof value !== "string" || !allowed.includes(value))
    throw new Error("허용되지 않는 복귀 주소입니다.");
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    url.hash ||
    url.search ||
    !["http:", "https:"].includes(url.protocol)
  )
    throw new Error("허용되지 않는 복귀 주소입니다.");
  if (
    url.protocol === "http:" &&
    !["localhost", "127.0.0.1"].includes(url.hostname)
  )
    throw new Error("복귀 주소에는 HTTPS가 필요합니다.");
  return url.href;
}
