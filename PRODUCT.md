# TGS Tracker

<!-- impeccable:product-schema 1 -->

## Platform
web

## Users
TGS 사내 동료가 담당 고객사의 요청을 함께 관리한다. 고객사 담당자는 로그인하지 않는다. 공개 포트폴리오 방문자는 가상 데이터로 된 읽기 전용 데모를 살펴본다.

## Product Purpose
요청과 조치 기록을 한곳에 모으고, 테스트에는 반영됐지만 운영에는 빠진 요청을 찾는다. 업무 완료와 운영 반영을 별도로 확인한다.

## Capabilities and Constraints
React/Vite/TypeScript, HashRouter URL, Supabase Auth·PostgreSQL RLS·비공개 이미지 Storage, GitHub Pages 정적 배포 구성이다. 일반 사용자는 담당 고객사, 관리자는 전체 고객사에 접근한다. 공개 데모는 쓰기·관리·초대를 제공하지 않는다. 내보내기는 후속 기능이며, 실제 Supabase/SMTP 통합 검증은 남아 있다.

## Brand Commitments
TGS Tracker 이름과 사용자가 제공한 `docs/TGS-Tracker-design-handoff.md`, HTML 시안을 따른다. 기존 업무 UI의 로고·서체·상태 색상 의미를 보존한다.

## Evidence on Hand
실제 구현, 가상 데이터 `src/lib/demo.ts`, 설계/작업 기록과 테스트가 있다. 실제 고객사 데이터, 성과 수치, 사용자 후기, 소개 영상은 제공되지 않았다. 이를 만들어 주장하지 않는다.

## Product Principles
- 완료와 운영 반영을 혼동하지 않는다.
- 권한은 서버·DB에서 검증한다.
- 실패한 저장과 업로드를 구분하고 초안을 보존한다.
- 데모는 가상 데이터와 조회 전용임을 밝힌다.

## Confirmed public entry
사용자는 2026-10-30 기존 업무 진입을 유지하는 별도 소개 페이지 추가를 선택했다.
