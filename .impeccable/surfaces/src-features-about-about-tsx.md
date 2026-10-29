---
version: 1
slug: "src-features-about-about-tsx"
primary_target: "src/features/about/About.tsx"
related_targets: ["src/features/about/about.css"]
---

# 포트폴리오 소개 페이지

모드: Persuade. 주소: `/#/about`. 기존 보드·루트 진입은 유지한다. 로그인 없이 소개를 보고 가상 데이터 데모로 이동한다.

## Direction contract

THESIS: 테스트 완료 뒤 빠진 운영 반영을 찾는 도구임을 첫 화면에서 설명한다. 제품이 아닌 장식이나 성과 지표를 앞세우지 않는다.

OWN-WORLD: 제공된 `TGS Tracker 소개.html`의 밝은 바탕, IBM Plex, 잉크 버튼, 네 상태와 운영 미반영 코랄을 유지한다. 새 브랜드를 발명하지 않는다.

STORY: 현장 문제 → 완료/배포를 분리한 설계 → 역할 → 기술 구성 → 가상 데이터 데모로 이어진다. 소개 영상·엑셀 내보내기·운영 검증을 완료했다고 주장하지 않는다.

FIRST VIEWPORT: 좌측 큰 제목과 설명·데모 링크, 우측 실제 데모 데이터로 만든 네 열 보드. 시안의 숫자 카드 대신 실제 예시 상태와 필터를 보여준다. 데모 열기, 설계서 링크와 섹션 탐색을 실제 연결한다.

FORM: 사용자가 지정한 HTML 구조를 코드로 이식한다. 새 세계/컨셉 추첨이나 이미지 생성은 필요하지 않다. 포트폴리오와 업무 화면을 연결하되 공개 소개에서 사내 데이터를 조회하지 않는다.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## 제약
기존 시각 체계의 확장으로 DESIGN.md 부재를 새 디자인 승인으로 해석하지 않는다. 배포·커밋·push 없음. 별도 소개 주소 추가는 사용자 확인 완료. 제공 HTML이 이미 시각 기준이므로 새 이미지 시안 대신 코드로 직접 구현하며 전역 buildPath 설정은 만들지 않는다. 새 래스터 자산은 사용하지 않는다.
