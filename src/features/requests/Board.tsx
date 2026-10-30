import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  useDndContext,
} from "@dnd-kit/core";
import type { DragEndEvent, KeyboardCoordinateGetter } from "@dnd-kit/core";
import { useSession } from "../../app/Session";
import { listRequests, rpc } from "../../lib/api";
import {
  deploymentLabel,
  errorMessage,
  formatDate,
  statuses,
} from "../../lib/domain";
import { demo } from "../../lib/supabase";
import { DeploymentRail } from "../../components/DeploymentRail";
import type { ListResult, RequestRow, Status } from "../../lib/types";
import { Alert, Empty, Loading, PageTitle } from "../../components/UI";
import { RequestFilters, useFilters } from "./Filters";
const statusKeys = Object.keys(statuses) as Status[];
const columnCoordinates: KeyboardCoordinateGetter = (
  event,
  { context, currentCoordinates },
) => {
  if (!["ArrowLeft", "ArrowRight"].includes(event.code)) return;
  const index = statusKeys.indexOf(
    (context.over?.id ||
      context.active?.data.current?.request.status) as Status,
  );
  const next = statusKeys[index + (event.code === "ArrowRight" ? 1 : -1)];
  const target = context.droppableRects.get(next),
    from = context.collisionRect;
  if (!target || !from) return;
  event.preventDefault();
  return {
    x: currentCoordinates.x + target.left - from.left,
    y: currentCoordinates.y + target.top - from.top,
  };
};
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
  const [mobileStatus, setMobileStatus] = useState<Status | null>(null);
  const [moveNotice, setMoveNotice] = useState("");
  const [dragRequest, setDragRequest] = useState<RequestRow | null>(null);
  const [desktop, setDesktop] = useState(
    () => window.matchMedia("(min-width:1001px) and (pointer:fine)").matches,
  );
  const suppressClick = useRef(false);
  useEffect(() => {
    const media = window.matchMedia("(min-width:1001px) and (pointer:fine)");
    const resize = () => setDesktop(media.matches);
    media.addEventListener("change", resize);
    return () => media.removeEventListener("change", resize);
  }, []);
  useEffect(() => {
    // 드롭 직후 발생하는 클릭만 막는다. 다음 실제 클릭은 pointerdown에서 다시 허용한다.
    const reset = () => {
      suppressClick.current = false;
    };
    const prevent = (event: MouseEvent) => {
      if (suppressClick.current && event.detail !== 0) {
        event.preventDefault();
        event.stopPropagation();
        suppressClick.current = false;
      }
    };
    document.addEventListener("pointerdown", reset, true);
    document.addEventListener("click", prevent, true);
    return () => {
      document.removeEventListener("pointerdown", reset, true);
      document.removeEventListener("click", prevent, true);
    };
  }, []);
  const key = JSON.stringify(filters);
  useEffect(() => {
    setPage(0);
    setMobileStatus(null);
    setLimits({
      received: 30,
      in_progress: 30,
      verification: 30,
      completed: 30,
    });
  }, [key, list]);
  const load = useCallback(
    async (background = false) => {
      if (!background) setLoading(true);
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
          setResults(
            Object.fromEntries(statusKeys.map((s, i) => [s, data[i]])),
          );
        }
        return true;
      } catch (e) {
        setError(errorMessage(e));
        return false;
      } finally {
        if (!background) setLoading(false);
      }
    },
    [key, list, page, limits],
  );
  useEffect(() => {
    void load();
  }, [load]);
  const summary = list ? listing : results.received,
    counts = summary?.counts;
  const total = Object.values(counts || {}).reduce((a, b) => a + b, 0);
  const activeStatus =
    mobileStatus || statusKeys.find((k) => counts?.[k]) || "received";
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, {
      keyboardCodes: {
        start: ["Space"],
        end: ["Space", "Enter", "Tab"],
        cancel: ["Escape"],
      },
      coordinateGetter: columnCoordinates,
    }),
  );
  async function move(r: RequestRow, status: Status) {
    if (r.status === status || busy) return;
    setBusy(true);
    setError("");
    setMoveNotice(`${r.title} 상태를 저장하고 있습니다.`);
    try {
      await rpc("update_request", {
        id: r.id,
        expected_version: r.version,
        patch: { status },
      });
      const refreshed = await load(true);
      setMoveNotice(
        refreshed
          ? `${r.title} → ${statuses[status]} 상태로 변경했습니다.`
          : `${r.title} 상태는 저장했지만 최신 현황을 불러오지 못했습니다. 다시 불러오기를 눌러 확인해주세요.`,
      );
    } catch (e) {
      setMoveNotice("");
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function dropped(e: DragEndEvent) {
    setDragRequest(null);
    if (!e.over) return;
    const r = e.active.data.current?.request as RequestRow;
    const s = e.over.id as Status;
    if (statusKeys.includes(s) && r) await move(r, s);
  }
  return (
    <>
      <PageTitle
        eyebrow="REQUEST WORKSPACE"
        title={filters.archived ? "보관함" : list ? "요청 목록" : "진행 현황"}
        description="테스트 반영 후, 운영에 빠진 요청을 확인합니다."
        action={
          !demo && (
            <Link className="button primary" to="/requests/new">
              요청 등록
            </Link>
          )
        }
      />
      <div className="overview-panels">
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
            <span
              className={`pending-count ${summary?.pending ? "has-pending" : ""}`}
            >
              {summary ? summary.pending.toLocaleString() : "—"}
            </span>
            <span className="release-copy">
              <strong>테스트 반영 · 운영 미반영</strong>
              <span>조치가 끝나도 운영 반영 여부는 별도로 확인합니다.</span>
            </span>
            <span className="release-link">
              {filters.deployment === "pending" ? "필터 해제" : "바로 보기"} →
            </span>
          </button>
        </section>
        <section
          className="distribution"
          aria-label="현재 필터의 진행 상태 분포"
        >
          <div className="distribution-heading">
            <span>진행 상태</span>
            <strong>
              {summary ? total.toLocaleString() : "—"}
              <small>건</small>
            </strong>
          </div>
          <div
            className="distribution-bar"
            role="img"
            aria-label={statusKeys
              .map((s) => `${statuses[s]} ${counts?.[s] || 0}건`)
              .join(", ")}
          >
            {statusKeys.map((s) => (
              <span
                key={s}
                className={s}
                style={{
                  width: `${total ? ((counts?.[s] || 0) / total) * 100 : 0}%`,
                }}
              />
            ))}
          </div>
          <div className="distribution-legend">
            {statusKeys.map((s) => (
              <span key={s}>
                <i className={`dot ${s}`} />
                {statuses[s]} <b>{counts?.[s] || 0}</b>
              </span>
            ))}
          </div>
        </section>
      </div>
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
      {filters.archived && (
        <Alert tone="info">
          보관된 요청은 읽기 전용입니다. 상세 화면에서 내용을 확인하고 복원할 수
          있습니다.
        </Alert>
      )}
      {moveNotice && <Alert tone="info">{moveNotice}</Alert>}
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
        <DndContext
          sensors={sensors}
          onDragStart={(e) => {
            setDragRequest(e.active.data.current?.request || null);
            suppressClick.current = e.activatorEvent.type === "pointerdown";
          }}
          onDragCancel={() => setDragRequest(null)}
          onDragEnd={(e) => void dropped(e)}
          accessibility={{
            screenReaderInstructions: {
              draggable:
                "Enter로 요청 상세를 엽니다. Space로 카드를 잡고 좌우 방향키로 상태를 선택한 뒤 Space로 놓으세요. Escape로 취소합니다. 상태 선택창으로도 변경할 수 있습니다.",
            },
          }}
        >
          {!demo && (
            <p className="board-drag-help">
              {desktop
                ? "카드를 잡아 다른 열로 옮기세요. 클릭하면 상세가 열립니다."
                : "카드의 상태 선택으로 진행 단계를 변경할 수 있습니다."}
            </p>
          )}
          <div
            className="mobile-stage-tabs"
            role="tablist"
            aria-label="진행 단계"
          >
            {statusKeys.map((s, index) => (
              <button
                key={s}
                role="tab"
                id={`stage-${s}`}
                aria-controls={`lane-${s}`}
                aria-selected={activeStatus === s}
                tabIndex={activeStatus === s ? 0 : -1}
                className={s}
                onClick={() => setMobileStatus(s)}
                onKeyDown={(e) => {
                  const next =
                    e.key === "ArrowRight"
                      ? (index + 1) % statusKeys.length
                      : e.key === "ArrowLeft"
                        ? (index + statusKeys.length - 1) % statusKeys.length
                        : e.key === "Home"
                          ? 0
                          : e.key === "End"
                            ? statusKeys.length - 1
                            : null;
                  if (next === null) return;
                  e.preventDefault();
                  setMobileStatus(statusKeys[next]);
                  e.currentTarget.parentElement
                    ?.querySelectorAll("button")
                    [next].focus();
                }}
              >
                {statuses[s]} <span>{counts?.[s] || 0}</span>
              </button>
            ))}
          </div>
          <div className="kanban">
            {statusKeys.map((s) => (
              <Column
                key={s}
                status={s}
                active={activeStatus === s}
                result={results[s]}
                more={() => setLimits((v) => ({ ...v, [s]: v[s] + 30 }))}
                move={move}
                busy={busy}
                desktop={desktop}
              />
            ))}
          </div>
          <DragOverlay dropAnimation={null}>
            {dragRequest && (
              <article
                className="request-card card-drag-preview"
                aria-hidden="true"
              >
                <div className="card-top">
                  <small>#{dragRequest.number}</small>
                </div>
                <strong className="card-title">{dragRequest.title}</strong>
                <DeploymentRail request={dragRequest} />
              </article>
            )}
          </DragOverlay>
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
  active,
  result,
  more,
  move,
  busy,
  desktop,
}: {
  status: Status;
  active: boolean;
  result?: ListResult;
  more: () => void;
  move: (r: RequestRow, s: Status) => Promise<void>;
  busy: boolean;
  desktop: boolean;
}) {
  const { active: dragActive } = useDndContext();
  const changing =
    !!dragActive && dragActive.data.current?.request.status !== status;
  const { setNodeRef, isOver } = useDroppable({
    id: status,
    disabled: demo || busy || !desktop,
  });
  return (
    <section
      ref={setNodeRef}
      id={`lane-${status}`}
      data-active={active}
      className={`kanban-column ${status} ${isOver ? "over" : ""}`}
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
          <RequestCard
            key={r.id}
            request={r}
            move={move}
            busy={busy}
            desktop={desktop}
          />
        ))}
        {!result?.rows.length && (
          <div className="column-empty">아직 요청이 없습니다</div>
        )}
        {isOver && changing && (
          <div className="drop-placeholder" role="status">
            놓으면 {statuses[status]} 상태로 변경
          </div>
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
  desktop,
}: {
  request: RequestRow;
  move: (r: RequestRow, s: Status) => Promise<void>;
  busy: boolean;
  desktop: boolean;
}) {
  const location = useLocation();
  const { customers, people } = useSession();
  const writable =
    !demo &&
    !r.archived_at &&
    !!customers.find((c) => c.id === r.customer_id)?.is_active;
  const draggable = writable && !busy && desktop;
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } =
    useDraggable({ id: r.id, data: { request: r }, disabled: !draggable });
  return (
    <article
      ref={setNodeRef}
      className={`request-card ${isDragging ? "dragging" : ""}`}
      data-draggable={draggable}
      onPointerDown={(e) => {
        if (
          !draggable ||
          e.pointerType !== "mouse" ||
          (e.target as Element).closest("select,option,input,textarea,button")
        )
          return;
        listeners?.onPointerDown?.(e);
      }}
    >
      <div className="card-top">
        <span className="customer-tag">
          {customers.find((c) => c.id === r.customer_id)?.name}
        </span>
        <small>#{r.number}</small>
      </div>
      <Link
        to={`/requests/${r.id}`}
        className="card-title"
        ref={setActivatorNodeRef}
        draggable={false}
        aria-describedby={
          draggable ? attributes["aria-describedby"] : undefined
        }
        aria-roledescription={draggable ? "이동 가능한 요청" : undefined}
        onKeyDown={(e) => {
          if (draggable) listeners?.onKeyDown?.(e);
        }}
        state={{ returnTo: location.pathname + location.search }}
      >
        {r.title}
      </Link>
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
      <DeploymentRail request={r} />
      {writable && (
        <select
          className="card-status"
          disabled={busy}
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
