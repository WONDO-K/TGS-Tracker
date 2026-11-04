export type Result = "matched" | "unmatched" | "review";
export type Repo = "web" | "api" | "portal";
export type Commit = {
  sha: string;
  title: string;
  author: string;
  date: string;
  result: Result;
  target?: string;
  evidence?: string;
  files: { name: string; added: number; removed: number }[];
};
export const resultLabels: Record<Result, string> = {
  matched: "반영",
  unmatched: "미반영",
  review: "확인 필요",
};
export const repositories: {
  id: Repo;
  customer: string;
  name: string;
  path: string;
}[] = [
  {
    id: "web",
    customer: "sample-one",
    name: "프런트엔드",
    path: "sample-company/customer-web",
  },
  {
    id: "api",
    customer: "sample-one",
    name: "백엔드",
    path: "sample-company/customer-api",
  },
  {
    id: "portal",
    customer: "sample-two",
    name: "고객 포털",
    path: "sample-company/customer-portal",
  },
];
export const targetCommits = [
  {
    sha: "e51a02b",
    title: "검색 조건 초기화 보완",
    note: "메시지는 유사하지만 수정 범위가 다릅니다. 변경 파일을 확인하세요.",
  },
  {
    sha: "d68c94f",
    title: "검색 입력값 유지 처리",
    note: "검색 폼 관련 변경입니다. 같은 수정인지 확인이 필요합니다.",
  },
  {
    sha: "c80b19a",
    title: "상세 화면 첨부 처리 수정",
    note: "다른 변경일 수 있습니다. 제목만으로 대응을 확정하지 마세요.",
  },
];
const commits: Commit[] = [
  {
    sha: "a82d91c",
    title: "로그인 실패 안내 개선",
    author: "샘플 작성자 A",
    date: "2026-11-02T01:15:00Z",
    result: "matched",
    target: "b90ef12",
    evidence: "체리픽 출처 확인",
    files: [{ name: "src/features/auth/Login.tsx", added: 18, removed: 6 }],
  },
  {
    sha: "b47f2e8",
    title: "검색 조건 초기화 동작 수정",
    author: "샘플 작성자 B",
    date: "2026-11-01T04:40:00Z",
    result: "unmatched",
    files: [
      { name: "src/features/search/SearchForm.tsx", added: 24, removed: 9 },
      { name: "src/features/search/SearchForm.test.ts", added: 16, removed: 0 },
    ],
  },
  {
    sha: "c15e09a",
    title: "날짜 범위 조회 조건 보완",
    author: "샘플 작성자 A",
    date: "2026-10-31T02:10:00Z",
    result: "review",
    evidence: "유사한 메시지의 후보 2건",
    files: [{ name: "src/lib/dateRange.ts", added: 12, removed: 5 }],
  },
  {
    sha: "d39a82f",
    title: "첨부 이미지 오류 안내 추가",
    author: "샘플 작성자 B",
    date: "2026-10-30T08:25:00Z",
    result: "matched",
    target: "d39a82f",
    evidence: "동일 SHA 확인",
    files: [
      { name: "src/features/attachments/Images.tsx", added: 11, removed: 3 },
    ],
  },
  {
    sha: "e62b10d",
    title: "목록 페이지 이동 시 필터 유지",
    author: "샘플 작성자 A",
    date: "2026-10-28T05:00:00Z",
    result: "unmatched",
    files: [{ name: "src/features/requests/List.tsx", added: 9, removed: 4 }],
  },
  {
    sha: "f09c74e",
    title: "요청 상세 내용 줄바꿈 개선",
    author: "샘플 작성자 B",
    date: "2026-10-24T00:20:00Z",
    result: "review",
    evidence: "변경 파일 확인 필요",
    files: [{ name: "src/features/requests/Detail.tsx", added: 6, removed: 2 }],
  },
  {
    sha: "a71e06b",
    title: "고객사 선택 항목 정렬",
    author: "샘플 작성자 A",
    date: "2026-10-15T06:35:00Z",
    result: "matched",
    target: "f13a26b",
    evidence: "체리픽 출처 확인",
    files: [
      { name: "src/features/customers/Select.tsx", added: 5, removed: 1 },
    ],
  },
];
export function previewCommits(repo: Repo): Commit[] {
  if (repo !== "api") return commits;
  return commits
    .slice(0, 4)
    .map((c, index) => ({
      ...c,
      title: [
        "API 응답의 날짜 형식 통일",
        "조회 조건 검증 보완",
        "첨부 파일 응답 코드 정리",
        "고객사 조회 범위 수정",
      ][index],
      files: [
        {
          name: `src/api/${["dates", "search", "attachments", "customers"][index]}.ts`,
          added: 14,
          removed: 4,
        },
      ],
    }));
}
