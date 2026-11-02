import type { Cell, SheetData } from "write-excel-file/universal";
import type {
  Customer,
  Filters,
  ListResult,
  Person,
  RequestRow,
} from "./types.ts";
import { deploymentLabel, localDatetime, statuses } from "./domain.ts";

export async function collectExportRequests(
  fetchPage: (limit: number, offset: number) => Promise<ListResult>,
  progress?: (loaded: number, total: number) => void,
) {
  const rows: RequestRow[] = [],
    ids = new Set<string>();
  let total: number | undefined;
  do {
    const page = await fetchPage(100, rows.length);
    total ??= page.total;
    if (page.total !== total || (!page.rows.length && rows.length < total))
      throw new Error(
        "조회 중 요청 목록이 변경되었습니다. 다시 다운로드해주세요.",
      );
    for (const row of page.rows) {
      if (ids.has(row.id))
        throw new Error(
          "조회 중 요청 목록이 변경되었습니다. 다시 다운로드해주세요.",
        );
      ids.add(row.id);
      rows.push(row);
    }
    if (rows.length > total)
      throw new Error(
        "조회 결과 건수가 일치하지 않습니다. 다시 다운로드해주세요.",
      );
    progress?.(rows.length, total);
  } while (rows.length < total);
  return rows;
}

export async function createRequestWorkbook(
  requests: RequestRow[],
  customers: Customer[],
  people: Person[],
  filters: Filters,
  generatedAt = new Date(),
  demo = false,
): Promise<Blob> {
  const { default: writeExcelFile } =
    await import("write-excel-file/universal");
  const customerNames = new Map(customers.map((c) => [c.id, c.name]));
  const personNames = new Map(people.map((p) => [p.id, p.display_name]));
  const text = (value: string | null): Cell => ({
    value: value || "",
    type: String,
    wrap: true,
    alignVertical: "top",
  });
  const reflected = (value: string | null, required: boolean): Cell =>
    text(!required ? "해당 없음" : value ? "반영" : "미반영");
  // Excel 날짜에는 시간대가 없으므로 한국 시각의 시계 값을 저장한다.
  const date = (value: string | null, required = true): Cell =>
    !required || !value
      ? null
      : {
          value: new Date(localDatetime(value) + ":00Z"),
          type: Date,
          format: "yyyy-mm-dd hh:mm",
          alignVertical: "top",
        };
  const header = (titles: string[]) =>
    titles.map((value) => ({
      value,
      type: String,
      fontWeight: "bold" as const,
      backgroundColor: "#171B25",
      textColor: "#FFFFFF",
      wrap: true,
    }));
  const data: SheetData = [
    header([
      "요청 번호",
      "고객사",
      "제목",
      "요청 내용",
      "고객사 요청자",
      "요청일",
      "작성자",
      "진행 상태",
      "조치 요약",
      "배포 필요",
      "배포 현황",
      "테스트 반영",
      "테스트 반영일 (한국 시간)",
      "운영 반영",
      "운영 반영일 (한국 시간)",
      "최근 수정 (한국 시간)",
      "보관 여부",
    ]),
    ...requests.map(
      (r) =>
        [
          { value: r.number, type: Number },
          text(customerNames.get(r.customer_id) || "알 수 없음"),
          text(r.title),
          text(r.description),
          text(r.requester_name),
          {
            value: new Date(r.requested_on + "T00:00:00Z"),
            type: Date,
            format: "yyyy-mm-dd",
          },
          text(personNames.get(r.created_by) || "알 수 없음"),
          text(statuses[r.status]),
          text(r.action_summary),
          text(r.requires_deployment ? "필요" : "불필요"),
          text(deploymentLabel(r)),
          reflected(r.test_deployed_at, r.requires_deployment),
          date(r.test_deployed_at, r.requires_deployment),
          reflected(r.production_deployed_at, r.requires_deployment),
          date(r.production_deployed_at, r.requires_deployment),
          date(r.updated_at),
          text(r.archived_at ? "보관" : "일반"),
        ] as Cell[],
    ),
  ];
  const deployments: Record<string, string> = {
    pending: "테스트 반영 · 운영 미반영",
    untested: "테스트 미반영",
    production: "운영 반영",
    unnecessary: "배포 불필요",
  };
  const conditions: SheetData = [
    header(["항목", "추출 조건"]),
    ["데이터 구분", demo ? "가상 데이터 · 읽기 전용 데모" : "업무 데이터"],
    [
      "추출 시각 (한국 시간)",
      localDatetime(generatedAt.toISOString()).replace("T", " "),
    ],
    ["요청 건수", requests.length],
    [
      "고객사",
      filters.customer
        ? customerNames.get(filters.customer) || "알 수 없음"
        : "접근 가능한 전체 고객사",
    ],
    ["검색어", filters.search || "전체"],
    ["진행 상태", "전체"],
    ["배포 상태", deployments[filters.deployment || ""] || "전체"],
    [
      "작성자",
      filters.author ? personNames.get(filters.author) || "알 수 없음" : "전체",
    ],
    ["요청일 시작", filters.from || "제한 없음"],
    ["요청일 종료", filters.to || "제한 없음"],
    ["보관 범위", filters.archived ? "보관된 요청" : "보관하지 않은 요청"],
    ["중지 고객사 포함", filters.inactive ? "포함" : "제외"],
    [
      "포함 범위",
      "현재 필터에 맞는 전체 요청. 화면의 페이지 및 모바일 상태 탭과 무관합니다.",
    ],
    ["제외 항목", "첨부 이미지, 활동 기록의 내부 메모 및 변경 이력, 인증 정보"],
    [
      "반영 여부 기준",
      "서버 배포 필요 시 각 반영일이 있으면 반영, 없으면 미반영입니다. 배포가 불필요하면 해당 없음으로 표시합니다. 요청의 진행 상태와는 별개입니다.",
    ],
    [
      "엑셀 필터 사용",
      "요청 현황 시트의 테스트 반영 또는 운영 반영 열에서 반영·미반영·해당 없음을 선택하세요.",
    ],
    [
      "조회 방식",
      "추출 중 데이터를 순차 조회하므로 동시에 변경된 데이터의 단일 시점 일치는 보장하지 않습니다.",
    ],
  ];
  return writeExcelFile(
    [
      {
        sheet: "요청 현황",
        data,
        stickyRowsCount: 1,
        stickyColumnsCount: 2,
        orientation: "landscape",
        columns: [
          12, 22, 38, 60, 18, 14, 18, 14, 60, 12, 20, 14, 24, 14, 24, 24, 12,
        ].map((width) => ({ width })),
      },
      {
        sheet: "추출 조건",
        data: conditions,
        columns: [{ width: 28 }, { width: 95 }],
      },
    ],
    {
      fontFamily: "맑은 고딕",
      fontSize: 11,
      features: [
        {
          files: {
            transform: {
              "xl/worksheets/sheet{id}.xml": {
                transform: (xml, options) =>
                  options.sheet === "요청 현황"
                    ? xml.replace(
                        "</sheetData>",
                        `</sheetData><autoFilter ref="A1:Q${data.length}"/>`,
                      )
                    : xml,
              },
            },
          },
        },
      ],
    },
  ).toBlob();
}
