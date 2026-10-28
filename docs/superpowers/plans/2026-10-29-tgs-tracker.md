# TGS Tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** 고객사별 접근이 분리된 요청·조치·배포 현황 관리 도구를 구현한다.
**Architecture:** React 정적 프런트는 GitHub Pages에, 데이터·인증·첨부는 Supabase에 둔다. 업무 쓰기는 검증된 RPC, 초대만 Edge Function으로 처리한다.
**Tech Stack:** React, Vite, TypeScript, React Router, dnd-kit, Supabase, Node test, PGlite(검증 전용).
**Spec:** ../specs/2026-10-29-tgs-tracker-design.md

## Global Constraints

- 서비스명 TGS Tracker, GitHub Pages + Supabase.
- 고객사용 계정 없음. 관리자 전체 접근, 일반 사용자 담당 고객사만 접근.
- 본문과 배포 상태는 별개. 완료된 요청도 운영 미반영 필터에 포함.
- 원본 10MB/저장 2MB/요청당 5장, private 버킷.
- 공개 데모는 정적 가상 데이터의 읽기 전용. 실무 인증 우회 없음.
- 외부 계정·프로젝트·배포 없이 로컬 구현과 검증을 완료한다. 실제 연결값은 .env.example/README로 인계.

## Review Focus

- 비담당 데이터의 직접 API 조회·변경 → DB 역할/JWT를 바꾸는 통합 검증.
- 차단된 기존 세션과 마지막 관리자 → DB 활성 검사와 병렬 변경 잠금 검증.
- 본문 저장 후 첨부 실패 → 저장된 상세로 이동하고 개별 파일 재시도 안내.
- 인증 callback 해시와 화면 경로 충돌 → callback 파서 및 브라우저 수락/만료 흐름 검증.
- 동시 수정·배포 날짜 초기화 → version 충돌 및 필드 검증 테스트.

## Task 1 — DB 계약과 검증

Files: supabase/migrations/202610290001_tracker.sql, supabase/tests/database.test.mjs, package.json.
Interfaces: create_request(payload), update_request(id, expected_version, patch), add_request_activity, set_request_archived, save_customer, set_customer_members, set_user_access, reserve_attachment, finalize_attachment, remove_attachment_record. 읽기: requests/customers/activities/attachments + get_people().

- [ ] Node test + PGlite로 Auth/Storage 최소 계약을 준비하고 요청 생성, 담당 분리, 완료·미반영, 충돌, 차단, 첨부 제한의 실패를 확인한다.
- [ ] 테이블·제약·RLS·RPC·private 버킷 정책을 구현한다. 모든 DEFINER 함수에 고정 search_path와 auth 검사.
- [ ] `npm test`에서 실제 SQL을 실행해 위 동작을 확인한다. PGlite는 Supabase Auth/Storage 서비스 자체의 대체 검증은 아니며 실제 환경 확인 절차를 README에 둔다.

## Task 2 — 앱·로그인·업무 화면

Files: src/lib/{types,domain,supabase,api,auth,image}.ts, src/app/{App,Session}.tsx, src/features/{auth,requests,admin}/*, src/styles.css, tests/domain.test.ts.
Interfaces: RequestRow/Customer/Profile/Attachment; listRequests(filters,status,limit,offset), getRequest(id), RPC wrapper. DB와 동일한 필드명.

- [ ] 배포 필터, 날짜 검증, callback 해석, 이미지 입력 제한에 대한 Node test 실패를 확인한다.
- [ ] HashRouter와 callback 선처리, 로그인·비밀번호 설정/재설정, 활성 사용자 검사를 구현한다.
- [ ] 보드/목록, 필터·건수·페이지, 상세/수정/활동, 등록, 관리자 화면과 첨부 흐름을 구현한다.
- [ ] 가상 데이터 읽기 전용 demo를 별도 빌드 모드로 연결한다.
- [ ] `npm test`, `npm run build`, 브라우저 화면/대표 동작으로 검증한다.

## Task 3 — 초대·배포·운영 인계

Files: supabase/functions/invite-user/index.ts, .github/workflows/deploy-pages.yml, .env.example, README.md.

- [ ] 초대 입력/관리자 검증과 기존 계정 복구·재송신 조건을 검증한다.
- [ ] 서버 secret과 고정 callback 주소를 사용하는 invite-user를 구현한다.
- [ ] 저장소 이름 기반 base, Pages Actions, 최초 관리자 SQL·SMTP·Auth 템플릿·백업·첨부 정리 절차를 문서화한다.
- [ ] 프로덕션/데모 빌드, 타입 검사, DB 테스트와 브라우저 확인을 실행한다.
- [ ] 별도 리뷰로 보안·데이터 손실·설계 누락을 확인하고 중요한 문제를 수정·재검증한다.

## 실행 기록

- 사용자가 설계에 입각한 개발 시작을 요청했으므로 별도 실행 방식 질문 없이 현재 세션에서 구현한다.
- 빈 새 폴더이며 기존 브랜치가 없으므로 worktree를 만들지 않는다. 로컬 소스만 작성하고 push/외부 배포는 수행하지 않는다.
- Docker가 실행되지 않아 PostgreSQL 검증은 PGlite를 사용한다. Auth/Storage의 전체 서비스 연동은 설정된 Supabase에서 추가 확인해야 한다.

### 2026-10-29 로컬 구현 결과

- Task 1: complete — 실제 SQL 마이그레이션 실행, 역할/JWT 변경을 통한 RLS·RPC·첨부 제한 확인. `npm test` 전체 16개 통과.
- Task 2: complete — 칸반·목록·등록·상세·관리자·이미지·인증 UI 구현. 브라우저 4개 통과, 실무/데모 타입 검사 및 빌드 성공.
- Task 3: 로컬 소스 complete — 초대 함수·GitHub Pages Actions·운영 README 작성. 외부 Supabase·SMTP·GitHub Pages 설정 및 원격 배포는 아직 수행하지 않음.
- Ruling: 빈 사용자 지정 폴더에서 직접 구현하고 로컬 feature 브랜치를 생성했다. 기존 브랜치와 업무 파일이 없어 별도 worktree는 만들지 않았다.
- Ruling: 사용자가 제공한 저장소 `WONDO-K/TGS-Tracker`를 origin으로 연결했다. 원격 저장소는 비어 있음을 확인했다. 외부 push나 공개 배포는 수행하지 않았다.
- Final review: 별도 에이전트가 소스를 검토했다. NULL version 우회는 SQL 회귀 검증으로, 미저장 입력 손실과 100건 이후 조회 실패는 브라우저에서 수정 전 실패를 재현하고 수정 후 통과했다. 첨부 부분 실패는 브라우저에서 예약 재사용·중복 방지 결과를 확인했다.
- 검증 한계: PGlite는 Supabase Auth/Storage/SMTP 서비스 자체를 실행하지 않는다. 브라우저 업무 모드 테스트는 외부 HTTP 경계만 가상 응답으로 대체한다. 초대 함수의 실제 배포·메일 도착·Storage 실물 및 여러 DB 연결의 동시성은 실제 프로젝트에서 검증해야 한다.
- Deferred minors: 없음.
