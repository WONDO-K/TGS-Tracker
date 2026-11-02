import { test } from "node:test";
import assert from "node:assert/strict";
import { unzipSync, strFromU8 } from "fflate";
import {
  collectExportRequests,
  createRequestWorkbook,
} from "../src/lib/request-export.ts";
import type { ListResult, RequestRow } from "../src/lib/types.ts";

const request: RequestRow = {
  id: "one",
  number: 1,
  customer_id: "customer-one",
  title: '=HYPERLINK("https://example.com","위험")',
  description: "한글 요청\n둘째 줄",
  requester_name: "담당자",
  requested_on: "2026-11-02",
  status: "completed",
  requires_deployment: true,
  test_deployed_at: "2026-11-01T23:30:00Z",
  production_deployed_at: null,
  action_summary: "+수식이 아닌 조치 요약",
  created_by: "author-one",
  updated_by: "author-one",
  created_at: "2026-11-01T23:00:00Z",
  updated_at: "2026-11-02T00:00:00Z",
  archived_at: null,
  version: 1,
};
const result = (rows: RequestRow[], total: number): ListResult => ({
  rows,
  total,
  counts: { received: 0, in_progress: 0, verification: 0, completed: total },
  pending: total,
});

test("내보내기는 서버 최대 100건씩 전체 페이지를 수집한다", async () => {
  const rows = Array.from({ length: 205 }, (_, i) => ({
    ...request,
    id: `row-${i}`,
    number: i + 1,
  }));
  const offsets: number[] = [];
  const all = await collectExportRequests(async (limit, offset) => {
    assert.equal(limit, 100);
    offsets.push(offset);
    return result(rows.slice(offset, offset + limit), rows.length);
  });
  assert.equal(all.length, 205);
  assert.deepEqual(offsets, [0, 100, 200]);
});

test("중간 오류·건수 변동·중복·누락 시 불완전한 내보내기를 거절한다", async () => {
  for (const mode of ["error", "count", "duplicate", "missing"]) {
    await assert.rejects(
      collectExportRequests(async (_limit, offset) => {
        if (!offset) return result([request], 2);
        if (mode === "error") throw new Error("권한이 변경되었습니다");
        if (mode === "count") return result([{ ...request, id: "two" }], 3);
        return result(mode === "duplicate" ? [request] : [], 2);
      }),
    );
  }
  assert.deepEqual(await collectExportRequests(async () => result([], 0)), []);
});

test("실제 xlsx에 한글·줄바꿈·필터·한국 시간과 안전한 문자열을 보존한다", async () => {
  const buffer = await createRequestWorkbook(
    [
      request,
      {
        ...request,
        id: "two",
        number: 2,
        requires_deployment: false,
        test_deployed_at: null,
      },
      { ...request, id: "three", number: 3, test_deployed_at: null },
      {
        ...request,
        id: "four",
        number: 4,
        test_deployed_at: null,
        production_deployed_at: "2026-11-02T00:00:00Z",
      },
      {
        ...request,
        id: "five",
        number: 5,
        production_deployed_at: "2026-11-02T00:00:00Z",
      },
    ],
    [{ id: "customer-one", name: "한빛 고객사", code: "HAN", is_active: true }],
    [{ id: "author-one", display_name: "작성자" }],
    {
      customer: "customer-one",
      deployment: "pending",
      search: "한글",
      from: "2026-11-01",
      to: "2026-11-02",
      archived: false,
    },
    new Date("2026-11-02T01:23:00Z"),
  );
  const zip = unzipSync(new Uint8Array(await buffer.arrayBuffer()));
  const xml = (path: string) => strFromU8(zip[path]);
  const sheet = xml("xl/worksheets/sheet1.xml");
  const strings = [
    ...xml("xl/sharedStrings.xml").matchAll(/<si><t[^>]*>(.*?)<\/t><\/si>/gs),
  ].map((m) =>
    m[1]
      .replaceAll("&quot;", '"')
      .replaceAll("&lt;", "<")
      .replaceAll("&gt;", ">")
      .replaceAll("&amp;", "&"),
  );
  const cell = (address: string) => {
    const m = sheet.match(
      new RegExp(`<c r="${address}"([^>]*)>(.*?)</c>`, "s"),
    );
    if (!m) return null;
    const value = m[2].match(/<v>(.*?)<\/v>/s)?.[1];
    return m[1].includes('t="s"') ? strings[Number(value)] : Number(value);
  };
  assert.equal((sheet.match(/<row /g) || []).length, 6);
  assert.equal(cell("B2"), "한빛 고객사");
  assert.equal(cell("C2"), request.title);
  assert.doesNotMatch(sheet, /<f[ >]/);
  assert.equal(cell("D2"), "한글 요청\n둘째 줄");
  assert.equal(cell("I2"), "+수식이 아닌 조치 요약");
  const expectedDate =
    (Date.parse("2026-11-02T08:30:00Z") - Date.UTC(1899, 11, 30)) / 86400000;
  assert.equal(cell("L1"), "테스트 반영");
  assert.equal(cell("N1"), "운영 반영");
  assert.equal(cell("L2"), "반영");
  assert.equal(cell("N2"), "미반영");
  assert.ok(Math.abs(Number(cell("M2")) - expectedDate) < 0.000001);
  assert.equal(cell("O2"), null);
  assert.equal(cell("L3"), "해당 없음");
  assert.equal(cell("N3"), "해당 없음");
  assert.equal(cell("M3"), null);
  assert.equal(cell("O3"), null);
  assert.equal(cell("L4"), "미반영");
  assert.equal(cell("N4"), "미반영");
  assert.equal(cell("L5"), "미반영");
  assert.equal(cell("N5"), "반영");
  assert.equal(cell("L6"), "반영");
  assert.equal(cell("N6"), "반영");
  assert.equal(cell("Q1"), "보관 여부");
  assert.equal(cell("K2"), "운영 반영 대기");
  assert.match(sheet, /state="frozen"/);
  assert.match(sheet, /autoFilter ref="A1:Q6"/);
  assert.match(xml("xl/styles.xml"), /yyyy-mm-dd hh:mm/);
  assert.match(xml("xl/workbook.xml"), /name="추출 조건"/);
  assert.ok(strings.includes("테스트 반영 · 운영 미반영"));
  assert.ok(strings.includes("2026-11-02 10:23"));
});
