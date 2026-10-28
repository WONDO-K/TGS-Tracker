import { useCallback, useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
} from "@dnd-kit/core";
import type { DragEndEvent } from "@dnd-kit/core";
import { useSession } from "../../app/Session";
import { listRequests, rpc } from "../../lib/api";
import {
  deploymentLabel,
  errorMessage,
  formatDate,
  statuses,
} from "../../lib/domain";
import { demo } from "../../lib/supabase";
import type { ListResult, RequestRow, Status } from "../../lib/types";
import { Alert, Empty, Loading, PageTitle } from "../../components/UI";
import { RequestFilters, useFilters } from "./Filters";
const statusKeys = Object.keys(statuses) as Status[];
export function Board({ list = false }: { list?: boolean }) {
  const location = useLocation();
  const { customers } = useSession(),
    { filters, change } = useFilters();
  const [results, setResults] = useState<Partial<Record<Status, ListResult>>>(
      {},
    ),
    [listing, setListing] = useState<ListResult | null>(null),
    [limits, setLimits] = useState<Record<Status, number>>({
      received: 30,
      in_progress: 30,
      verification: 30,
      completed: 30,
    }),
    [page, setPage] = useState(0),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const key = JSON.stringify(filters);
  useEffect(() => {
    setPage(0);
    setLimits({
      received: 30,
      in_progress: 30,
      verification: 30,
      completed: 30,
    });
  }, [key, list]);
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      if (list) setListing(await listRequests(filters, null, 30, page * 30));
      else {
        // ponytail: 로딩된 페이지를 새로 조회한다. 큰 보드에서 요청량이 문제가 되면 변경된 열만 갱신한다.
        const data = await Promise.all(
          statusKeys.map(async (s) => {
            const pages = await Promise.all(
              Array.from({ length: Math.ceil(limits[s] / 30) }, (_, i) =>
                listRequests(filters, s, 30, i * 30),
              ),
            );
            return { ...pages[0], rows: pages.flatMap((p) => p.rows) };
          }),
        );
        setResults(Object.fromEntries(statusKeys.map((s, i) => [s, data[i]])));
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [key, list, page, limits]);
  useEffect(() => {
    void load();
  }, [load]);
  const summary = list ? listing : results.received,
    counts = summary?.counts;
  const total = Object.values(counts || {}).reduce((a, b) => a + b, 0);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor),
  );
  async function move(r: RequestRow, status: Status) {
    if (r.status === status || busy) return;
    setBusy(true);
    try {
      await rpc("update_request", {
        id: r.id,
        expected_version: r.version,
        patch: { status },
      });
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function dropped(e: DragEndEvent) {
    if (!e.over) return;
    const r = e.active.data.current?.request as RequestRow;
    const s = e.over.id as Status;
    if (statusKeys.includes(s) && r) await move(r, s);
  }
  return (
    <>
      <PageTitle
        eyebrow="REQUEST WORKSPACE"
        title={list ? "요청 목록" : "진행 현황"}
        description="테스트 반영 후, 운영에 빠진 요청을 확인합니다."
        action={
          !demo && (
            <Link className="button primary" to="/requests/new">
              요청 등록
            </Link>
          )
        }
      />
      <section className="release-summary" aria-label="운영 반영 확인">
        <button
          className={`release-review ${filters.deployment === "pending" ? "selected" : ""}`}
          aria-pressed={filters.deployment === "pending"}
          onClick={() =>
            change(
              "deployment",
              filters.deployment === "pending" ? "" : "pending",
            )
          }
        >
          <span className="release-route">
            테스트 <span aria-hidden="true">→</span> 운영
          </span>
          <span className="release-answer">
            <strong>
              {summary ? (summary.pending || 0).toLocaleString() : "—"}
            </strong>
            <span>건 운영 반영 대기</span>
          </span>
          <span className="release-link">
            {filters.deployment === "pending"
              ? "전체로 돌아가기"
              : "미반영 요청 확인"}{" "}
            <span aria-hidden="true">→</span>
          </span>
        </button>
        <dl className="scope-summary">
          <div>
            <dt>현재 조건의 요청</dt>
            <dd>
              {summary ? total.toLocaleString() : "—"}
              <small>건</small>
            </dd>
          </div>
          <div>
            <dt>진행 중</dt>
            <dd>
              {counts?.in_progress || 0}
              <small>건</small>
            </dd>
          </div>
          <div>
            <dt>조치 완료</dt>
            <dd>
              {counts?.completed || 0}
              <small>건</small>
            </dd>
          </div>
        </dl>
      </section>
      <div className="workspace-toolbar">
        <div>
          <Link
            className={!list ? "view-tab active" : "view-tab"}
            to={{ pathname: "/board", search: location.search }}
          >
            칸반보드
          </Link>
          <Link
            className={list ? "view-tab active" : "view-tab"}
            to={{ pathname: "/requests", search: location.search }}
          >
            목록
          </Link>
        </div>
        <button
          className="quiet"
          onClick={() => void load()}
          disabled={loading || busy}
        >
          {loading ? "불러오는 중" : "새로고침"}
        </button>
      </div>
      <RequestFilters filters={filters} change={change} />
      {error && (
        <Alert>
          {error}{" "}
          <button className="text-button" onClick={() => void load()}>
            다시 불러오기
          </button>
        </Alert>
      )}
      {loading ? (
        <Loading />
      ) : list ? (
        <div className="table-wrap request-table-wrap">
          <table>
            <thead>
              <tr>
                <th className="request-number">번호</th>
                <th>요청사항</th>
                <th>진행 상태</th>
                <th className="date-cell">테스트 반영</th>
                <th className="date-cell">운영 반영</th>
              </tr>
            </thead>
            <tbody>
              {listing?.rows.map((r) => (
                <tr
                  key={r.id}
                  className={
                    r.requires_deployment &&
                    r.test_deployed_at &&
                    !r.production_deployed_at
                      ? "awaiting-production"
                      : ""
                  }
                >
                  <td className="request-number" data-label="요청 번호">
                    #{r.number}
                  </td>
                  <td>
                    <Link
                      className="row-title"
                      to={`/requests/${r.id}`}
                      state={{ returnTo: location.pathname + location.search }}
                    >
                      {r.title}
                    </Link>
                    <div className="muted">
                      {customers.find((c) => c.id === r.customer_id)?.name} ·{" "}
                      {formatDate(r.requested_on)}
                    </div>
                  </td>
                  <td className="table-status">
                    <span className={`status-pill ${r.status}`}>
                      {statuses[r.status]}
                    </span>
                  </td>
                  <td className="date-cell" data-label="테스트">
                    {!r.requires_deployment
                      ? "해당 없음"
                      : formatDate(r.test_deployed_at)}
                  </td>
                  <td className="date-cell" data-label="운영">
                    {!r.requires_deployment
                      ? "해당 없음"
                      : formatDate(r.production_deployed_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!listing?.rows.length && <Empty />}
          <div className="pagination">
            <button disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
              이전
            </button>
            <span>
              {listing?.total
                ? `${page * 30 + 1}–${Math.min((page + 1) * 30, listing.total)} / ${listing.total}건`
                : "0건"}
            </span>
            <button
              disabled={(page + 1) * 30 >= (listing?.total || 0)}
              onClick={() => setPage((p) => p + 1)}
            >
              다음
            </button>
          </div>
        </div>
      ) : (
        <DndContext sensors={sensors} onDragEnd={(e) => void dropped(e)}>
          <div className="kanban">
            {statusKeys.map((s) => (
              <Column
                key={s}
                status={s}
                result={results[s]}
                more={() => setLimits((v) => ({ ...v, [s]: v[s] + 30 }))}
                move={move}
                busy={busy}
              />
            ))}
          </div>
        </DndContext>
      )}
      <div className="board-footer">
        <span>
          <i className="dot green" />{" "}
          {demo ? "가상 데이터 · 읽기 전용 데모" : "팀과 공유되는 요청 현황"}
        </span>
        <span>완료 상태와 운영 반영 여부는 별도로 관리됩니다.</span>
      </div>
    </>
  );
}
function Column({
  status,
  result,
  more,
  move,
  busy,
}: {
  status: Status;
  result?: ListResult;
  more: () => void;
  move: (r: RequestRow, s: Status) => Promise<void>;
  busy: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: status,
    disabled: demo || busy,
  });
  return (
    <section
      ref={setNodeRef}
      className={`kanban-column ${isOver ? "over" : ""}`}
      aria-label={`${statuses[status]} 열`}
    >
      <header>
        <span>
          <i className={`dot ${status}`} />
          {statuses[status]} <b>{result?.total || 0}</b>
        </span>
      </header>
      <div className="column-body">
        {result?.rows.map((r) => (
          <RequestCard key={r.id} request={r} move={move} busy={busy} />
        ))}
        {!result?.rows.length && (
          <div className="column-empty">아직 요청이 없습니다</div>
        )}
        {(result?.rows.length || 0) < (result?.total || 0) && (
          <button className="wide quiet" onClick={more}>
            더 보기
          </button>
        )}
      </div>
    </section>
  );
}
function RequestCard({
  request: r,
  move,
  busy,
}: {
  request: RequestRow;
  move: (r: RequestRow, s: Status) => Promise<void>;
  busy: boolean;
}) {
  const location = useLocation();
  const { customers, people } = useSession();
  const writable =
    !demo &&
    !busy &&
    !r.archived_at &&
    !!customers.find((c) => c.id === r.customer_id)?.is_active;
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: r.id, data: { request: r }, disabled: !writable });
  return (
    <article
      ref={setNodeRef}
      className={`request-card ${isDragging ? "dragging" : ""}`}
      style={{
        transform: transform
          ? `translate3d(${transform.x}px,${transform.y}px,0)`
          : undefined,
      }}
    >
      <div className="card-top">
        <span className="customer-tag">
          {customers.find((c) => c.id === r.customer_id)?.name}
        </span>
        {writable ? (
          <button
            className="drag-handle"
            {...listeners}
            {...attributes}
            aria-label={`${r.title} 카드 이동`}
          >
            ⠿
          </button>
        ) : (
          <small>#{r.number}</small>
        )}
      </div>
      <Link
        to={`/requests/${r.id}`}
        className="card-title"
        state={{ returnTo: location.pathname + location.search }}
      >
        {r.title}
      </Link>
      <div className="environment-pair" aria-label={deploymentLabel(r)}>
        <span>
          테스트{" "}
          <b>
            {!r.requires_deployment
              ? "해당 없음"
              : r.test_deployed_at
                ? "반영"
                : "미반영"}
          </b>
        </span>
        <span
          className={
            r.requires_deployment &&
            r.test_deployed_at &&
            !r.production_deployed_at
              ? "release-gap"
              : ""
          }
        >
          운영{" "}
          <b>
            {!r.requires_deployment
              ? "해당 없음"
              : r.production_deployed_at
                ? "반영"
                : "미반영"}
          </b>
        </span>
      </div>
      <div className="card-meta">
        <span className="avatar">
          {people
            .find((p) => p.id === r.created_by)
            ?.display_name.slice(0, 1) || "·"}
        </span>
        <span>
          {people.find((p) => p.id === r.created_by)?.display_name || "사용자"}
        </span>
        <time>{formatDate(r.requested_on)}</time>
      </div>
      {(r.attachment_count || 0) > 0 && (
        <small className="muted">첨부 {r.attachment_count}개</small>
      )}
      {writable && (
        <select
          className="card-status"
          aria-label={`${r.title} 진행 상태`}
          value={r.status}
          onChange={(e) => void move(r, e.target.value as Status)}
        >
          {statusKeys.map((s) => (
            <option key={s} value={s}>
              {statuses[s]}
            </option>
          ))}
        </select>
      )}
    </article>
  );
}
