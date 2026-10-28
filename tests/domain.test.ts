import { test } from "node:test";
import assert from "node:assert/strict";
import {
  deploymentLabel,
  matchesFilters,
  parseAuthCallback,
  validateImage,
  validateDeployment,
  todayKST,
} from "../src/lib/domain.ts";

test("완료 요청도 테스트 반영·운영 미반영 목록에 포함한다", () => {
  const r = {
    status: "completed",
    requires_deployment: true,
    test_deployed_at: "2026-01-01T00:00:00Z",
    production_deployed_at: null,
    customer_id: "a",
    title: "화면 오류",
    description: "검색",
    requested_on: "2026-01-01",
    created_by: "u",
    archived_at: null,
  };
  assert.equal(matchesFilters(r, { deployment: "pending" }), true);
  assert.equal(deploymentLabel(r), "운영 반영 대기");
  assert.equal(
    matchesFilters(
      { ...r, production_deployed_at: "2026-01-02T00:00:00Z" },
      { deployment: "pending" },
    ),
    false,
  );
  assert.equal(matchesFilters(r, { search: "없는 말" }), false);
});
test("인증 토큰을 화면 경로와 혼동하지 않고 복구 유형을 구분한다", () => {
  assert.deepEqual(
    parseAuthCallback("https://a.github.io/TGS-Tracker/#/board"),
    { kind: "none" },
  );
  assert.deepEqual(
    parseAuthCallback(
      "https://a.github.io/TGS-Tracker/?token_hash=abc&type=invite",
    ),
    { kind: "otp", token_hash: "abc", type: "invite" },
  );
  assert.equal(
    parseAuthCallback(
      "https://a.github.io/TGS-Tracker/#access_token=a&refresh_token=b&type=recovery",
    ).kind,
    "session",
  );
  assert.equal(
    parseAuthCallback(
      "https://a.github.io/TGS-Tracker/?token_hash=x&type=admin",
    ).kind,
    "error",
  );
  assert.equal(
    parseAuthCallback(
      "https://a.github.io/TGS-Tracker/?error=expired&error_description=Link+expired",
    ).kind,
    "error",
  );
});
test("원본 이미지 크기·형식과 미래 배포일을 거절한다", () => {
  assert.throws(
    () => validateImage({ type: "image/svg+xml", size: 100 }),
    /PNG/,
  );
  assert.throws(
    () => validateImage({ type: "image/png", size: 11 * 1024 * 1024 }),
    /10MB/,
  );
  assert.doesNotThrow(() => validateImage({ type: "image/png", size: 1024 }));
  assert.throws(() => validateDeployment(true, "2999-01-01T00:00", ""), /미래/);
  assert.equal(todayKST(new Date("2026-10-28T16:00:00Z")), "2026-10-29");
});
