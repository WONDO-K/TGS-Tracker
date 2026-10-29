import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Brand } from "../../components/Brand";
import { demoRequests } from "../../lib/demo";
import { deploymentLabel, statuses } from "../../lib/domain";
import { demo } from "../../lib/supabase";
import type { RequestRow, Status } from "../../lib/types";
import "./about.css";

const statusKeys = Object.keys(statuses) as Status[];
const isPending = (r: RequestRow) =>
  r.requires_deployment &&
  !!r.test_deployed_at &&
  !r.production_deployed_at &&
  !r.archived_at;
const sourceUrl = "https://github.com/WONDO-K/TGS-Tracker";
const designUrl =
  sourceUrl +
  "/blob/main/docs/superpowers/specs/2026-10-29-tgs-tracker-design.md";

export function About() {
  const { hash } = useLocation();
  useEffect(() => {
    const previous = document.title;
    document.title = "TGS Tracker · 고객사 요청·배포 관리";
    return () => {
      document.title = previous;
    };
  }, []);
  useEffect(() => {
    if (!hash) {
      window.scrollTo(0, 0);
      return;
    }
    requestAnimationFrame(() => {
      const section = document.getElementById(hash.slice(1));
      section?.scrollIntoView();
      section?.focus({ preventScroll: true });
    });
  }, [hash]);
  const entry = demo ? "/board" : "/login",
    entryLabel = demo ? "데모 열어보기" : "서비스 로그인";
  return (
    <div className="about-page">
      <a className="about-skip" href="#/about#problem">
        소개 본문으로 이동
      </a>
      <header className="about-header about-width">
        <Brand to="/about" />
        <nav aria-label="소개 페이지 메뉴">
          <Link to="/about#problem">문제</Link>
          <Link to="/about#decisions">설계 판단</Link>
          <Link to="/about#roles">역할</Link>
          <Link className="button primary" to={entry}>
            {demo ? "데모 보기" : "로그인"}
          </Link>
        </nav>
      </header>
      <main className="about-width">
        <section className="about-hero" aria-labelledby="about-title">
          <div>
            <h1 id="about-title">
              테스트에는 있고
              <br />
              <em>운영에는 없는</em> 요청,
              <br />
              놓치지 않게.
            </h1>
            <p>
              고객사 요청을 팀이 함께 기록하고, 조치부터 테스트·운영 반영까지
              한곳에서 추적합니다. 운영에 빠진 건은 한 번의 필터로 바로
              찾습니다.
            </p>
            <div className="about-actions">
              <Link className="button primary" to={entry}>
                {entryLabel}
              </Link>
              <a
                className="button"
                href={designUrl}
                target="_blank"
                rel="noreferrer"
              >
                설계서 보기
              </a>
            </div>
            <p className="about-hero-note">
              가상 데이터로 살펴보는 TGS 내부 업무 도구
            </p>
          </div>
          <BoardPreview />
        </section>

        <section
          className="about-section"
          id="problem"
          tabIndex={-1}
          aria-labelledby="problem-title"
        >
          <h2 id="problem-title">현장에서 풀고 싶었던 문제</h2>
          <p className="about-lead">
            요청이 많지 않아도 기록이 흩어지면 놓치는 건이 생깁니다.
          </p>
          <div className="about-problems">
            <article>
              <h3>요청 기록이 사람마다 따로 남는다</h3>
              <p>
                같은 고객사를 여러 동료가 담당해도 요청을 한곳에서 함께 보고
                이어서 처리해야 했습니다.
              </p>
            </article>
            <article>
              <h3>화면 캡처가 개인 PC에 묶인다</h3>
              <p>
                공유 폴더 없이 웹에서 바로 올리고, 요청과 함께 열어볼 수 있어야
                했습니다.
              </p>
            </article>
            <article>
              <h3>테스트에서 끝난 건이 운영에서 빠진다</h3>
              <p>
                조치가 끝난 요청 중 운영 반영이 남은 건을 즉시 찾아야 했습니다.
              </p>
            </article>
          </div>
        </section>

        <section
          className="about-section"
          id="decisions"
          tabIndex={-1}
          aria-labelledby="decisions-title"
        >
          <h2 id="decisions-title">설계 판단</h2>
          <p className="about-lead">
            기능을 늘리기보다, 놓치기 쉬운 지점을 구조로 막았습니다.
          </p>
          <div className="about-decisions">
            <article>
              <h3>완료와 운영 반영을 분리했습니다</h3>
              <p>
                진행 상태는 칸반으로, 테스트·운영 반영은 별도 기록으로
                관리합니다. 완료 열에서도 운영 미반영 요청을 찾을 수 있습니다.
              </p>
              <Link to={demo ? "/board?deployment=pending" : "/about#preview"}>
                운영 미반영 요청 보기
              </Link>
            </article>
            <article>
              <h3>핵심 필터를 화면 맨 위에 뒀습니다</h3>
              <p>
                테스트 반영·운영 미반영 건수를 먼저 보여줍니다.
                고객사·검색·기간으로 범위를 좁혀 남은 배포를 확인합니다.
              </p>
            </article>
            <article>
              <h3>권한은 화면이 아니라 DB에서 막습니다</h3>
              <p>
                담당 고객사별 접근을 DB 정책으로 검사합니다. 관리자 메뉴를
                숨기는 것과 별개로 조회·변경 권한을 확인합니다.
              </p>
            </article>
            <article>
              <h3>이미지가 실패해도 본문은 남습니다</h3>
              <p>
                요청 저장과 이미지 업로드를 단계로 나눴습니다. 저장된 본문을
                유지하며 첨부 상태를 확인하고, 실패한 이미지를 다시 올릴 수
                있습니다.
              </p>
            </article>
          </div>
        </section>

        <section
          className="about-section"
          id="roles"
          tabIndex={-1}
          aria-labelledby="roles-title"
        >
          <h2 id="roles-title">역할별 동작</h2>
          <p className="about-lead">
            작성자가 아닌, 담당 고객사 단위로 함께 일합니다.
          </p>
          <div className="about-role-table">
            <table>
              <caption className="sr-only">
                역할별 접근 범위와 제공 기능
              </caption>
              <thead>
                <tr>
                  <th scope="col">역할</th>
                  <th scope="col">할 수 있는 일</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">일반 사용자</th>
                  <td>
                    담당 고객사의 모든 요청을 조회·등록·수정하고, 조치 기록과
                    배포 정보를 남깁니다.
                  </td>
                </tr>
                <tr>
                  <th scope="row">관리자</th>
                  <td>
                    전체 고객사에 접근하고 고객사·사용자·담당 배정을 관리하며,
                    요청을 보관·복원합니다.
                  </td>
                </tr>
                <tr>
                  <th scope="row">고객사 담당자</th>
                  <td>
                    서비스에 로그인하지 않습니다. 고객사 전달을 위한 엑셀·인쇄
                    내보내기는 후속 기능입니다.
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section className="about-section" aria-labelledby="stack-title">
          <h2 id="stack-title">기술 구성</h2>
          <p className="about-lead">
            정적 화면과 관리형 백엔드로 구성했습니다.
          </p>
          <dl className="about-stack">
            <div>
              <dt>GitHub Pages</dt>
              <dd>
                React · Vite · TypeScript
                <br />
                정적 프런트엔드 배포 구성
              </dd>
            </div>
            <div>
              <dt>Supabase Auth</dt>
              <dd>
                이메일 로그인
                <br />
                관리자 초대
              </dd>
            </div>
            <div>
              <dt>PostgreSQL</dt>
              <dd>
                고객사별 데이터 분리
                <br />
                RLS 접근 제어
              </dd>
            </div>
            <div>
              <dt>Storage</dt>
              <dd>
                비공개 이미지
                <br />
                인증 후 조회
              </dd>
            </div>
          </dl>
        </section>

        <section className="about-section" aria-labelledby="demo-title">
          <div className="about-demo">
            <div>
              <h2 id="demo-title">데모는 가상 데이터로 구성했습니다</h2>
              <p>
                보드, 목록, 상세 조회를 살펴볼 수 있습니다. 공개 데모에는
                편집·관리·초대 기능과 실제 고객사 자료를 제공하지 않습니다.
              </p>
              {!demo && (
                <p>
                  현재 업무 화면은 팀 계정으로 로그인한 뒤 이용할 수 있습니다.
                  위 미리보기에는 가상 요청만 표시합니다.
                </p>
              )}
            </div>
            <Link className="button primary" to={entry}>
              {entryLabel}
            </Link>
          </div>
        </section>
      </main>
      <footer className="about-footer about-width">
        <span>
          TGS Tracker · 포트폴리오 소개
          <br />
          표시된 고객사명과 요청은 가상 데이터입니다.
        </span>
        <a href={sourceUrl} target="_blank" rel="noreferrer">
          GitHub 저장소
        </a>
      </footer>
    </div>
  );
}

function BoardPreview() {
  const [pendingOnly, setPendingOnly] = useState(false);
  const pending = demoRequests.filter(isPending).length,
    requests = demoRequests.filter((r) => !pendingOnly || isPending(r));
  return (
    <section
      className="about-preview"
      id="preview"
      tabIndex={-1}
      aria-label="가상 데이터 칸반 미리보기"
    >
      <div className="about-preview-header">
        <strong>진행 현황</strong>
        <span>가상 데이터</span>
      </div>
      <div
        className="about-preview-filters"
        role="group"
        aria-label="미리보기 배포 필터"
      >
        <button
          type="button"
          aria-pressed={!pendingOnly}
          onClick={() => setPendingOnly(false)}
        >
          전체 요청 {demoRequests.length}
        </button>
        <button
          type="button"
          aria-pressed={pendingOnly}
          onClick={() => setPendingOnly(true)}
        >
          운영 미반영 {pending}건
        </button>
      </div>
      <div className="about-preview-lanes">
        {statusKeys.map((status) => {
          const lane = requests.filter((r) => r.status === status);
          return (
            <section
              className={`about-preview-lane ${status}`}
              key={status}
              aria-label={`${statuses[status]} 미리보기`}
            >
              <h3>
                {statuses[status]} <span>{lane.length}</span>
              </h3>
              {lane.slice(0, 2).map((r) => (
                <article className="about-preview-card" key={r.id}>
                  <span className="about-preview-id">#{r.number}</span>
                  {demo ? (
                    <Link to={`/requests/${r.id}`}>{r.title}</Link>
                  ) : (
                    <strong>{r.title}</strong>
                  )}
                  <span
                    className={
                      isPending(r) ? "about-pending" : "about-deployment"
                    }
                  >
                    {isPending(r) ? "운영 미반영" : deploymentLabel(r)}
                  </span>
                </article>
              ))}
              {!lane.length && (
                <p className="about-preview-empty">해당 요청 없음</p>
              )}
            </section>
          );
        })}
      </div>
      <p className="about-preview-caption" role="status">
        {pendingOnly
          ? `테스트 반영 후 운영에 남은 ${requests.length}건`
          : "각 단계에서 최대 2건씩 표시합니다."}
      </p>
    </section>
  );
}
