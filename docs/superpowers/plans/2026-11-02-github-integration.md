# GitHub OAuth 및 커밋 대조 Implementation Plan

> For agentic workers: implement independent domains with fresh context, preserve uncommitted approved UI, and review the integrated feature once. No commit, push or production deployment without user instruction.

**Goal:** 승인된 커밋 대조 UI에 실제 GitHub.com OAuth·비공개 저장소·브랜치·커밋 조회와 수동 대응 저장을 연결한다.

**Architecture:** GitHub Pages는 Supabase 인증된 Edge Function `github`에만 요청한다. 함수는 사용자별 OAuth 토큰을 AES-GCM으로 암호화 저장하고, 기존 활성 계정 및 고객사 범위와 GitHub 권한을 검증한다. 실제 배포 상태나 요청 관리 데이터는 변경하지 않는다.

**Tech Stack:** React/TypeScript, Supabase Edge Functions/PostgreSQL, GitHub REST, Web Crypto. 새 런타임 의존성 없음.

**Spec:** docs/commit-compare-ui.md 및 대화에서 승인된 계정별 GitHub 연결/독립 커밋 대조 흐름. DTO는 supabase/functions/github/contracts.ts.

## 범위와 결정

- OAuth App 웹 인증: state + PKCE, 서버 callback, 만료/일회성 state, 허용된 프런트 복귀 주소만 사용. 초기 v1은 access token 만료 시 재연결하며 refresh token은 저장하지 않는다.
- `repo` OAuth 권한은 GitHub 특성상 넓지만 이 구현은 저장소 GET 조회만 수행한다. GitHub 저장소 내용·브랜치·배포를 수정하지 않는다. 권한 범위를 연결 안내에 명시한다.
- GitHub 연결은 사용자별, 저장소 등록은 관리자만 고객사별로 수행한다. 등록된 저장소의 조회/수동 대응은 활성 담당자만 가능하며 현재 사용자 GitHub 권한도 매번 확인한다. 직접 DB에서 토큰·상태·대응 기록에 접근할 수 없다.
- 인증 세대(generation)를 저장하고 시작/해제/콜백 저장을 검증해 늦은 콜백이 해제된 연결을 되살리지 않게 한다. 기존 연결 토큰은 새 OAuth 완료 전까지 유지한다.
- 동일 SHA, 정확한 원본 SHA의 체리픽 출처 표기, 검증된 수동 대응만 확인으로 표시한다. 메시지 일치는 후보이며 미확인으로 단정하지 않는다. 기준 최대 500건, 대상 최대 1000건의 순차 조회 한도를 명시하고 한도 도달 시 미완료/검토 필요로 표시한다.
- 분기 기준 SHA를 고정한다. 대상은 기간으로 잘라내지 않고 한도 내 이력을 검색한다. 실제 서버 배포와 되돌리기 이후 유효성은 판단하지 않는다.
- 실제 키 등록·클라우드 마이그레이션/함수 배포는 설정 가이드를 완성한 후 사용자 단계로 남긴다. 외부 저장소·실제 고객사 데이터는 테스트에서 사용하지 않는다.

## 작업

- [x] GitHub GET 클라이언트/페이지/대조·상세/조상 검증 및 모의 HTTP 테스트.
- [x] OAuth PKCE·암호화·콜백·API 핸들러, 세대/상태/비밀 보관 마이그레이션, 권한·콜백 회귀 테스트.
- [x] 기존 미리보기 보존, 실무 계정 연결·저장소 등록·조회·대조·변경 파일·대응 저장/해제 및 브라우저 테스트.
- [x] 통합 타입/DB/단위/브라우저/빌드, 보안·UX 별도 리뷰, 설정 가이드와 완료/미검증 범위 기록.

완료 근거: 단위/DB49·브라우저 전체71 통과, 일반/데모 빌드·Deno 함수 검사 통과. 보안/프런트 리뷰 지적 각2건 수정 후 재검토에서 해결 확인. 실제 화면 1440/768/390px 검토 및 별도 UI 마무리 판정 `ship`. 기존 시각 체계 확장임을 문서화 점검했다. 실제 OAuth App 등록·클라우드 설정/배포·비공개 저장소 실검증은 설정 가이드에 따른 후속이며 자동 테스트는 합성 HTTP 경계를 사용했다.

## API 계약

함수 POST body `{action,...}`. 성공은 아래 DTO 객체, 오류는 `{error:{code,message}}`와 적절한 HTTP 상태다. 외부 OAuth 콜백만 GET `/github/callback`이다.

- status → GitHubConnection
- connect `{returnUrl}` → `{url}`
- complete `{ticket}` → `{ok:true}` (연결을 시작한 TGS 사용자만 완료)
- disconnect → `{ok:true, revoked:boolean}`
- repositories `{customerId}` → `{repositories:GitHubRepository[]}`
- accessibleRepositories `{page}` → `{repositories:AccessibleRepository[],hasMore:boolean}`
- attachRepository `{customerId,fullName}` → `{repository:GitHubRepository}` (관리자)
- detachRepository `{repositoryId}` → `{ok:true}` (관리자, 기록 보존을 위해 비활성화)
- branches `{repositoryId,page}` → `{branches:GitHubBranch[],hasMore:boolean}`
- compare `{repositoryId,baseBranch,targetBranch,days}` → Comparison
- commit `{repositoryId,sha}` → CommitDetail (7–40자리 SHA 허용)
- saveLink `{repositoryId,baseBranch,targetBranch,sourceSha,targetSha}` → `{link:ManualLink}` (완전한 SHA, 양쪽 브랜치 도달 검증)
- deleteLink `{repositoryId,baseBranch,targetBranch,sourceSha}` → `{ok:true}`

프런트 callback 복귀는 `/#/commits?github=pending&ticket=...` 또는 `github=denied|error`다. 사용자에 묶인 일회성 티켓을 URL에서 즉시 제거하고 인증된 complete 요청으로 연결을 확정한다. 토큰/인증 코드는 프런트에 보내지 않는다. 서버 설정: APP_URL, GITHUB_RETURN_URLS(선택, 전체 URL 목록), GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, GITHUB_TOKEN_KEY(base64 32bytes), GITHUB_CALLBACK_URL(선택, 기본 프로젝트 함수 callback).
