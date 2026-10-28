# TGS Tracker

고객사 요청·조치·테스트 및 운영 반영 현황을 관리하는 TGS 내부 도구입니다. React + Vite + TypeScript, Supabase, GitHub Pages로 구성합니다.

## 로컬 실행

Node.js 24 이상을 사용합니다.

```powershell
npm ci
npm run dev -- --mode demo
```

표시되는 localhost 주소에서 가상 고객사 2곳의 읽기 전용 보드·목록·상세를 확인할 수 있습니다. 데모에서는 Supabase 연결과 로그인·쓰기·관리자 기능을 시작하지 않습니다.

실제 연결은 `.env.example`을 `.env.local`로 복사하고 Supabase 프로젝트 URL과 **publishable 키**를 입력한 뒤 `npm run dev`로 실행합니다. 로컬에서 저장소 하위 경로를 원하지 않으면 `VITE_BASE_PATH=/`로 설정합니다. secret/service_role 키는 프런트에 넣지 마세요.

## 구현 범위

- 관리자 전체 접근, 일반 사용자 담당 고객사별 접근. 담당 고객사 내에서는 동료 요청도 함께 조치.
- 요청 등록·수정·조치/내부 메모, 읽기 전용 보관·복원.
- 칸반·목록·고객사/검색/작성자/요청일/배포 상태 필터.
- 완료 여부와 분리된 테스트·운영 반영 기록, 운영 미반영 목록.
- private 이미지 첨부, 업로드 예약·확정·실패 재시도.
- 초대·역할·접근 차단·고객사 배정과 최초 관리자 보호.
- Excel·문서 출력은 후속 범위입니다.

## Supabase 최초 설정

1. 프로젝트를 생성하고 SQL Editor에서 `supabase/migrations/202610290001_tracker.sql`을 실행합니다. 새 프로젝트를 전제로 하며 기존 같은 이름의 테이블이 있는 곳에 재실행하지 않습니다. 이후 변경은 새 마이그레이션으로 관리합니다.
2. Authentication에서 공개 회원가입을 끄고 Email 로그인을 사용합니다. Auth의 비밀번호 최소 길이도 앱과 같은 10자 이상으로 설정합니다.
3. Authentication → Users에서 본인 계정을 생성한 뒤 아래 SQL을 실행합니다. 해당 계정의 이메일로 바꿉니다.

```sql
update public.profiles
set role = 'admin', is_active = true
where email = '본인@회사이메일';
```

4. Auth Site URL은 `https://wondo-k.github.io/TGS-Tracker/`, 허용 Redirect URL에는 같은 주소와 로컬 루트 주소를 등록합니다. `#/board` 같은 화면 주소를 callback으로 등록하지 않습니다.
5. Invite user와 Reset password 이메일 템플릿의 링크를 각각 아래처럼 변경합니다. HashRouter와 충돌하지 않고 다른 기기에서도 token_hash를 검증합니다. 이메일 보안 스캐너가 링크를 미리 여는 환경에서는 OTP 또는 별도 확인 단계를 추가 검토하세요.

초대 템플릿:

```html
<a href="{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=invite"
  >TGS Tracker 비밀번호 설정</a
>
```

비밀번호 재설정 템플릿:

```html
<a href="{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=recovery"
  >비밀번호 재설정</a
>
```

6. 실제 동료 초대 전 Custom SMTP를 설정하고 발신자·수신자 제한, 발송 한도와 메일 도착을 확인합니다. 기본 메일 발송 설정만으로 임의의 수신자에게 전달된다고 가정하지 않습니다.
7. Storage `request-images`가 private, 최대 2MB, JPEG/PNG/WebP 허용으로 설정되었는지 확인합니다. 공개 정책이나 별도 광범위 Storage 정책을 추가하지 않습니다.

### 초대 함수 배포

Supabase CLI 로그인과 프로젝트 연결 후:

```powershell
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase secrets set APP_URL=https://wondo-k.github.io/TGS-Tracker/
npx supabase functions deploy invite-user
```

기본 제공 서버 환경변수 SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY를 사용합니다. 함수 gateway JWT 검사는 config에서 끄고, 함수 내부에서 반드시 `getUser(token)` 및 현재 DB의 활성 관리자 검사를 수행합니다. APP_URL은 서버에서 고정하고 임의 redirect를 받지 않습니다. 로컬에서 함수까지 시험할 때는 APP_URL을 실제 로컬 프런트 주소로 맞춘 별도 테스트 환경을 사용합니다.

신규 계정은 member로만 활성화되고 고객사 배정 전에는 자료를 볼 수 없습니다. 기존 계정 재발송은 역할·배정을 유지합니다. 미확인 계정에는 초대를 재발송하고 확인된 계정에는 비밀번호 재설정 메일을 보냅니다. 접근 차단된 기존 사용자는 관리자가 먼저 활성화해야 합니다. Auth 생성 뒤 DB 설정에 실패하면 비활성 프로필이 남을 수 있으므로 사용자 목록에서 확인하고 복구합니다.

## GitHub Pages 배포

저장소: https://github.com/WONDO-K/TGS-Tracker

1. Settings → Pages → Source: **GitHub Actions**.
2. `main` 브랜치의 push가 검증·빌드·배포를 실행합니다. PR은 검증과 빌드만 수행합니다.
3. 기본 모드는 `demo`입니다. 실제 업무 운영 시 Settings → Secrets and variables → Actions → **Variables**에 아래를 지정합니다.

| 이름                     | 값                    |
| ------------------------ | --------------------- |
| APP_MODE                 | live                  |
| SUPABASE_URL             | 프로젝트 URL          |
| SUPABASE_PUBLISHABLE_KEY | 공개용 publishable 키 |

위 값은 정적 JS에 포함됩니다. **비밀 키를 넣지 않습니다.** `APP_MODE=live`인데 연결값이 없으면 배포 빌드는 실패합니다. Actions → Run workflow에서 demo/live를 선택할 수도 있습니다. 모드를 바꾸면 같은 Pages 주소의 배포가 교체되므로 공개 포트폴리오와 실무는 다른 저장소/배포로 분리하세요.

프로젝트 사이트 경로 `/TGS-Tracker/`는 워크플로가 저장소 이름으로 설정합니다. 주소는 `https://wondo-k.github.io/TGS-Tracker/#/board` 형태입니다. 사용자 루트 사이트 또는 커스텀 도메인으로 변경하면 base를 `/`로 조정합니다. HTTPS 강제도 활성화합니다.

GitHub Pages는 프런트 파일을 공개 제공하고 Supabase가 인증과 데이터 접근을 처리합니다. Pages의 민감한 거래 관련 공식 이용 안내는 설계서 참고 문서에 기록했습니다.

## 검증

```powershell
npm test
npm run build
npm run build:demo
```

브라우저 검증은 `npm run test:browser`로 실행합니다. 로컬은 설치된 Microsoft Edge를 사용하며 테스트가 데모 서버와 가상 API를 사용하는 실무 모드 서버를 자동 실행합니다. CI/Linux에서는 `npx playwright install --with-deps chromium` 후 `CI=true npm run test:browser`를 사용합니다. 이 검증은 실제 UI·Supabase SDK를 실행하지만 외부 Auth/Storage HTTP 응답은 테스트가 대체하므로 실제 서비스 연결 검증과 구분합니다.

DB 테스트는 PGlite에서 실제 마이그레이션을 실행하고 PostgreSQL 역할·auth.uid를 바꿔 담당 분리, 차단, 직접 쓰기 금지, 배포 규칙, 수정 충돌, 보관, 첨부 정책을 검증합니다. **Auth/Storage 서비스와 SMTP 자체는 로컬 SQL 테스트 범위가 아닙니다.** 실제 Supabase를 설정한 뒤 다음을 별도로 확인해야 합니다.

- 관리자·같은 고객사 담당자·다른 고객사 담당자 로그인 후 직접 API 호출과 이미지 접근.
- 차단한 기존 로그인 세션, 담당 해제 후 접근, 동시 관리자 강등 및 동시 요청 수정.
- 새 기기에서 초대 링크 수락, 만료 링크, 비밀번호 재설정·재발송.
- 이미지 업로드 중 네트워크 중단, 저장 한도 도달, 재시도와 파일 삭제.
- GitHub Pages 하위 경로의 새로고침, 인증 callback 및 SMTP 메일 수신.

## 첨부 및 데이터 보존

- 원본 10MB, 저장 2MB, 요청당 pending+ready 최대 5장입니다. 필요한 이미지만 첨부합니다.
- 이미지 실물과 DB는 원자적 트랜잭션이 아닙니다. 본문 저장 후 이미지가 실패하면 상세 화면에서 확인합니다. pending 파일은 업로드 확인·다시 선택·삭제로 처리합니다.
- 파일 삭제는 Storage API가 먼저, DB 행 삭제가 나중입니다. SQL로 storage.objects 메타데이터만 지우지 않습니다.
- 본문은 보관 처리하고 영구 삭제하지 않습니다. 고객사를 중지하거나 계정을 차단해도 기록은 남습니다.
- DB 덤프와 Storage 파일은 따로 백업합니다. DB 백업만으로 이미지가 복원되지는 않습니다. 별도 테스트 프로젝트에 DB 복원 후 Storage 파일을 경로 그대로 복원하고 접근 정책을 확인합니다.
- Supabase 대시보드에서 용량·전송량·프로젝트 중지·백업 보관 조건을 확인합니다.

잔여 pending 점검(SQL Editor, 운영자 전용):

```sql
select id, request_id, storage_path, original_name, created_at
from public.request_attachments
where state = 'pending' and created_at < now() - interval '1 day';
```

관리자는 해당 요청 상세에서 실물을 확인한 뒤 첨부를 확정하거나 삭제합니다. 읽기 전용 요청은 먼저 고객사 활성화·요청 복원이 필요합니다. 파일이 없는 ready 행은 Storage 상태를 점검하고 삭제·재첨부합니다.

설계와 구현 순서는 `docs/superpowers/`에 있습니다. 실제 고객사 자료와 인증 키는 저장소·공개 데모에 포함하지 않습니다.
