# GitHub 커밋 대조 설정

현재 코드는 실제 GitHub.com OAuth, 비공개 저장소 조회, 브랜치 대조, 변경 파일 조회와 수동 대응 저장을 지원한다. GitHub 앱 등록과 아래 Supabase 배포 설정을 완료해야 실제 연결할 수 있다. 기존 TGS 이메일 로그인과 요청/배포 기록은 변경하지 않는다.

## 1. GitHub OAuth App 등록

GitHub Settings → Developer settings → OAuth Apps → New OAuth App에서 등록한다.

| 항목 | 설정 |
|---|---|
| Application name | TGS Tracker |
| Homepage URL | `https://wondo-k.github.io/TGS-Tracker/` |
| Authorization callback URL | `https://YOUR_PROJECT_REF.supabase.co/functions/v1/github/callback` |

콜백 주소는 **Supabase Edge Function 주소**다. GitHub Pages의 `#/commits`나 Supabase Auth의 `/auth/v1/callback`을 넣지 않는다. Supabase Authentication의 GitHub 로그인 공급자를 켤 필요도 없다. TGS 로그인에 연결된 별도 GitHub OAuth 기능이다.

발급된 Client ID와 Client secret은 다음 단계에서 Supabase 서버에만 설정한다. GitHub Pages Repository variables나 `VITE_` 환경변수, 브라우저 저장소에는 넣지 않는다. 회사 조직이 OAuth App 접근 승인을 요구하면 조직 관리자 승인도 필요하다.

OAuth App의 `repo` 권한은 비공개 코드 읽기뿐 아니라 쓰기 권한도 포함한다. 이 앱은 GitHub 저장소 코드를 수정하지 않으며, 조회와 OAuth 인증/연결 해제만 수행한다. 저장소별 읽기 권한으로 더 좁혀 운영하려면 추후 GitHub App으로 변경할 수 있다.

## 2. 추가 DB 마이그레이션

기존 프로젝트의 SQL Editor에서 **새 파일만** 실행한다.

`supabase/migrations/202611020001_github.sql`

기존 `202610290001_tracker.sql`은 다시 실행하지 않는다. 새 테이블은 연결 암호문·일회성 인증 상태·고객사 저장소 등록·수동 커밋 대응을 보관한다. 일반 사용자와 관리자 모두 브라우저에서 이 테이블에 직접 접근하지 못하며 Edge Function이 권한을 검사한 후 사용한다.

## 3. Edge Function 서버 비밀 설정

Supabase Dashboard의 Edge Functions → Secrets에서 다음을 설정한다. `APP_URL`이 이미 초대 기능용으로 설정돼 있으면 운영 주소를 유지한다.

| 이름 | 예시 / 의미 |
|---|---|
| `APP_URL` | `https://wondo-k.github.io/TGS-Tracker/` |
| `GITHUB_CLIENT_ID` | 등록한 OAuth App의 Client ID |
| `GITHUB_CLIENT_SECRET` | OAuth App의 Client secret |
| `GITHUB_TOKEN_KEY` | 암호화용 임의 32바이트의 표준 base64 문자열 |
| `GITHUB_RETURN_URLS` | 허용할 앱 루트 전체 URL, 쉼표로 구분. 생략 시 APP_URL 사용 |
| `GITHUB_CALLBACK_URL` | 선택. 기본값은 프로젝트 URL의 `/functions/v1/github/callback` |

암호화 키는 로컬 터미널에서 생성해 Secrets에 복사한다.

```powershell
node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('base64'))"
```

예를 들어 운영 페이지와 현재 로컬 앱을 함께 허용하려면:

```text
GITHUB_RETURN_URLS=https://wondo-k.github.io/TGS-Tracker/,http://127.0.0.1:5177/
```

포트와 경로는 실제 앱의 주소와 일치시킨다. GitHub Pages 하위 경로와 마지막 `/`까지 포함하는 루트 주소를 권장한다. HTTP는 localhost/127.0.0.1 개발 주소만 허용한다. 로컬 포트를 바꾸면 허용 목록도 수정한다. 서버 콜백 URL은 로컬 프런트를 사용할 때도 등록한 Supabase 함수 주소를 유지할 수 있다.

CLI를 쓸 경우 `supabase/functions/.env.example`을 무시되는 `supabase/functions/.env`로 복사하고 값을 입력한 뒤 업로드한다. 실제 비밀 파일은 커밋하지 않는다.

```powershell
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase secrets set --env-file supabase/functions/.env
npx supabase functions deploy github
```

`SUPABASE_URL`과 `SUPABASE_SERVICE_ROLE_KEY`는 함수의 기본 제공 서버 환경변수를 사용한다. 함수의 gateway JWT 검사는 공개 OAuth 콜백을 위해 끄지만, 콜백 외 모든 POST는 함수 내부에서 TGS JWT·활성 프로필·고객사 범위를 확인한다.

## 4. 화면에서 연결·등록

1. 실제 업무 모드에서 TGS Tracker에 로그인하고 **커밋 대조 → GitHub 연결**을 누른다.
2. GitHub에서 계정과 권한을 승인한다. 돌아오면 현재 TGS 계정에 묶인 일회성 승인 완료 절차를 수행한다.
3. 관리자가 고객사를 선택하고 접근 가능한 GitHub 저장소를 해당 고객사에 등록한다. 여러 저장소를 등록할 수 있다.
4. 담당자는 본인의 GitHub 계정을 연결한다. 같은 고객사라도 본인 GitHub 계정이 저장소에 접근할 수 있어야 조회할 수 있다.
5. 저장소·기준 브랜치·대상 브랜치·기간을 선택해 대조한다. 행에서 변경 파일/패치를 확인하고 필요한 경우 운영 측 커밋을 검증해 수동 대응을 저장한다.

관리자의 저장소 연결 해제는 등록을 비활성화하고 수동 대응 기록은 보존한다. GitHub 계정 연결 해제는 현재 사용자의 토큰을 삭제하고 GitHub 토큰 폐기도 시도한다. GitHub와 통신하지 못해 폐기를 확인하지 못하면 GitHub Settings의 Authorized OAuth Apps에서도 승인을 해제한다.

## 대조 결과 해석

- 동일 SHA 또는 전체 원본 SHA의 체리픽 출처 표기는 대응 근거다. 커밋 제목 일치는 **검토 후보**이며 자동 확정하지 않는다.
- 수동 연결은 양쪽 커밋이 각각 선택한 브랜치에 도달 가능한지 확인한 후 저장한다. 다음 조회에서 대상 커밋을 확인하지 못하면 검토 필요로 표시한다.
- 기준 브랜치 tip과 대상 tip을 고정해 조회한다. 기준은 선택 기간 내 최대 500건, 대상은 기간 제한 없이 최대 1000건이다. 한도에 도달하면 조회 미완료를 명시하며, 대상 이력이 불완전할 때 대응을 못 찾은 행은 미확인으로 단정하지 않는다.
- 파일 상세는 최대 300개이며 더 있으면 불완전함을 표시한다. 바이너리나 큰 파일에는 패치가 제공되지 않을 수 있다.
- 결과는 커밋 대응 관계다. 실제 서버 배포, 이후 되돌리기, 충돌 수정의 의미적 동일성은 보장하지 않는다. 기존 테스트/운영 반영일을 자동 수정하지 않는다.
- GitHub API 응답의 페이지·권한·속도 제한을 따르며 저장소나 브랜치를 생성/수정하지 않는다. 캐시된 결과도 인증 만료·접근 권한 오류에는 숨긴다.

## 인증·보관 정책

state와 PKCE를 사용하고 처음 인증 상태는 10분, 콜백 이후 완료 티켓은 5분 유효하다. 콜백만으로는 연결을 확정하지 않으며, 연결을 시작한 TGS 계정의 인증된 완료 요청을 요구한다. 토큰/인증 코드는 프런트에 보내지 않고 짧게 유효한 내부 티켓만 복귀 URL에 넣어 즉시 제거한다.

GitHub access token과 임시 인증 코드는 AES-GCM으로 사용자에 묶어 암호화한다. 암호화 키는 서버 비밀에만 둔다. 키를 잃거나 바꾸면 기존 연결은 다시 승인해야 한다. 이 버전은 refresh token을 보관하지 않으므로 GitHub 앱에서 만료 토큰을 사용하는 경우 만료 후 재연결이 필요하다. TGS의 30분 미사용 로그아웃은 별도로 유지한다.

## 검증 범위

로컬 자동 검증은 외부 GitHub/Auth HTTP를 가상 응답으로 대체하고 실제 핸들러·암호화·SQL·React 화면을 실행한다. 실제 비공개 저장소 연결은 위 설정/함수 배포 후 별도로 확인한다. 외부 배포·저장소 조작·토큰 등록을 자동 테스트가 수행하지 않는다.

```powershell
npm test
npm run test:browser
npm run build
npm run build:demo
npx --yes deno check supabase/functions/github/index.ts
```

참고: [GitHub OAuth 웹 인증](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps), [커밋 API](https://docs.github.com/en/rest/commits/commits), [Supabase 함수 비밀 설정](https://supabase.com/docs/guides/functions/secrets).
