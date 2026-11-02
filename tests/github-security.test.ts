import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decryptToken,
  encryptToken,
  hashState,
  makeOAuthRequest,
  allowedReturnUrl,
} from "../supabase/functions/github/security.ts";

const key = btoa(String.fromCharCode(...new Uint8Array(32).fill(17)));
test("OAuth state·PKCE는 추측 불가능하며 원본 비밀을 URL에 남기지 않는다", async () => {
  const a = await makeOAuthRequest(
    "client",
    "https://project.supabase.co/functions/v1/github/callback",
  );
  const b = await makeOAuthRequest(
    "client",
    "https://project.supabase.co/functions/v1/github/callback",
  );
  const url = new URL(a.url);
  assert.notEqual(a.state, b.state);
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("scope"), "repo");
  assert.equal(a.state.length, 43);
  assert.equal(a.verifier.length, 43);
  assert.equal((await hashState(a.state)).length, 64);
  assert.ok(!a.url.includes(a.verifier));
  assert.equal(url.origin, "https://github.com");
});
test("OAuth 토큰은 사용자에 묶인 AES-GCM 암호문으로만 보관한다", async () => {
  const secret = "gho_test_private_token";
  const encrypted = await encryptToken(secret, key, "user-a");
  assert.ok(!encrypted.includes(secret));
  assert.equal(await decryptToken(encrypted, key, "user-a"), secret);
  await assert.rejects(() => decryptToken(encrypted, key, "user-b"));
  await assert.rejects(() =>
    decryptToken(encrypted.slice(0, -4) + "AAAA", key, "user-a"),
  );
  await assert.rejects(() => encryptToken(secret, btoa("short"), "user-a"));
});
test("OAuth 복귀 주소는 등록된 정확한 앱 루트만 허용한다", () => {
  const urls = [
    "https://wondo-k.github.io/TGS-Tracker/",
    "http://127.0.0.1:5177/",
  ];
  assert.equal(allowedReturnUrl(urls[0], urls), urls[0]);
  for (const bad of [
    "https://evil.test/",
    "https://wondo-k.github.io/other/",
    "https://wondo-k.github.io/TGS-Tracker/?next=evil",
    "javascript:alert(1)",
    "https://wondo-k.github.io@evil.test/TGS-Tracker/",
    "https://wondo-k.github.io/TGS-Tracker/#/other",
  ]) {
    assert.throws(() => allowedReturnUrl(bad, urls));
  }
});
