---
version: 1
slug: "src-features-commits-commitcompare-tsx"
primary_target: "src/features/commits/CommitCompare.tsx"
related_targets: ["src/features/commits/LiveCommitCompare.tsx", "src/features/commits/CommitPreview.tsx", "src/features/commits/commits.css", "src/features/commits/preview.ts", "src/app/App.tsx"]
---

# 커밋 대조

모드: Operate. 주소: `/#/commits`. 요청 관리와 독립적으로 브랜치 사이의 대응 커밋과 확인되지 않은 변경을 검토한다. 데모는 가상 미리보기, 실무는 OAuth/API 연동 화면을 제공한다. 실제 외부 설정·배포 및 비공개 저장소 실연결 검증은 남아 있다. 아래 방향 계약과 제약은 UI 우선 단계의 이력이며 최신 범위는 후속 기록을 따른다.

## Direction contract

THESIS: 기준 브랜치의 변경이 비교 대상 브랜치에 대응하는지 근거를 보고 판단한다. 커밋 대응과 서버 배포 완료를 혼동하지 않는다.

OWN-WORLD: 기존 업무 화면의 흰색 사이드바, 밝은 캔버스, IBM Plex Sans KR/Mono, 잉크 버튼, 가는 구분선과 절제된 상태 색상을 확장한다. `src/handoff.css`의 현행 스타일과 공유 폼/알림/확인 대화상자를 계승하며 새 전역 시각 체계를 만들지 않는다.

STORY: 연결 전 안내 또는 가상 결과 → 고객사/저장소/브랜치/기간 적용 → 검색과 대응 결과 분류 → 커밋 상세의 근거/변경 파일 → 후보 검토와 가상 수동 연결/해제로 이어진다. 동일 SHA, 체리픽 출처, 미확인, 검토 필요, 수동 대응을 구분한다.

FIRST VIEWPORT: 제목, 가상 데이터와 단계 제한, 미리보기 상태 선택기, 비교 조건, 적용 범위와 기준 시각, 결과 필터/검색, 커밋 목록을 보여준다. 데모는 결과로, 실무 모드는 연결 전 안내로 시작한다.

FORM: PC 표와 근거 패널, 1200px 이하 세로 패널, 700px 이하 세로 행/상세 화면으로 같은 작업을 유지한다. 조건은 대조하기로 적용하고 동일 브랜치는 차단한다. 상세 닫기/Escape/목록 복귀 시 원래 행 또는 검색 입력에 초점을 돌린다. 일시 조회 오류는 이전 결과를 보존하고 인증/권한 안내는 결과를 숨긴다.

FINISH: 최종 완료 검토 판정 `ship`(가상 UI 단계). 근거 화면 12개는 `.impeccable/review/commits/`, 탐지 결과는 `work/commit-ui-detect.json`의 `[]`. 검증 시점과 후속 범위는 `docs/commit-compare-ui.md`에 기록한다. 새 래스터 자산은 없으며 화면 캡처는 검토 증거다.

## 제약과 다음 단계

실제 회사 저장소·OAuth·GitHub API·토큰 저장·DB 변경·배포를 수행하지 않는다. 수동 대응은 저장소+기준 브랜치+대상 브랜치+기준 SHA 키의 메모리 상태이며 화면 이탈/새로고침으로 초기화된다. 실제 OAuth/API 연결, 접근 범위와 토큰/수동 대응 보관 정책, 통합 검증은 다음 단계다. 기존 `PRODUCT.md`의 내보내기/데모 설명 드리프트는 이번 작업에서 수정하거나 새 규칙으로 확정하지 않는다.

## 2026-11-02 실제 연동 후속

- 실무의 사용자별 연결·관리자 저장소 매핑·API 조회·대응 DB 저장을 구현했다. 사용자 인증된 완료 티켓과 암호화 서버 보관을 사용하고 기존 요청의 반영 상태는 변경하지 않는다. 설정 절차는 `docs/github-setup.md`에 기록했다.
- 고객사/저장소/기준·대상 브랜치/기간 → 대조 결과 → 대응 근거 또는 변경 파일 흐름과 기존 시각 규칙을 보존했다. 일반 오류는 결과를 유지하고 인증/권한 오류는 숨긴다. 계정 변경 시 확인창을 닫고 늦은 응답을 버린다.
- 별도 마무리 리뷰 `ship`: 주요 수정 사항 없음. 1440/768/390px 결과·파일 증거 6개는 `.impeccable/review/github-live/`, 탐지 1회 `work/github-live-detect.json`은 `[]`. 단위/DB49·브라우저71·일반/데모 빌드·Deno 검사 통과.
- 문서화 점검은 기존 `src/handoff.css`, `styles.css`, 공유 UI/Confirm과 커밋 화면을 비교했다. 기존 팔레트·서체·236px 사이드바·1200/700px 패널 전환과 폼을 확장한 작업이므로 새 전역 DESIGN.md/sidecar를 만들지 않았다. 기존 PRODUCT.md 드리프트는 그대로 남겼다.
- 실제 GitHub OAuth App 등록·클라우드 마이그레이션·함수 배포·비밀 설정과 실제 비공개 저장소 연결 검증은 미수행이다. 커밋·push도 하지 않았다.
