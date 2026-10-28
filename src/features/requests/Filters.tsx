import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useSession } from "../../app/Session";
import type { Filters } from "../../lib/types";
export function useFilters() {
  const [params, setParams] = useSearchParams();
  const key = params.toString();
  const filters = useMemo<Filters>(
    () => ({
      customer: params.get("customer") || "",
      search: params.get("search") || "",
      deployment: params.get("deployment") || "",
      from: params.get("from") || "",
      to: params.get("to") || "",
      author: params.get("author") || "",
      archived: params.get("archived") === "true",
      inactive: params.get("inactive") === "true",
    }),
    [key],
  );
  function change(name: string, value: string) {
    setParams(
      (old) => {
        const next = new URLSearchParams(old);
        if (name === "reset") return new URLSearchParams();
        if (value) next.set(name, value);
        else next.delete(name);
        return next;
      },
      { replace: true },
    );
  }
  return { filters, change };
}
export function RequestFilters({
  filters,
  change,
}: {
  filters: Filters;
  change: (name: string, value: string) => void;
}) {
  const { customers, people, profile } = useSession();
  const [search, setSearch] = useState(filters.search || "");
  useEffect(() => {
    setSearch(filters.search || "");
  }, [filters.search]);
  useEffect(() => {
    if (search === (filters.search || "")) return;
    const timer = setTimeout(() => change("search", search), 300);
    return () => clearTimeout(timer);
  }, [search, filters.search]);
  return (
    <div className="filters">
      <div className="filter-main">
        <label className="search-field">
          <input
            aria-label="제목·내용 검색"
            placeholder="제목 또는 요청 내용 검색"
            value={search}
            maxLength={200}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <select
          aria-label="고객사 필터"
          value={filters.customer}
          onChange={(e) => change("customer", e.target.value)}
        >
          <option value="">전체 고객사</option>
          {customers
            .filter((c) => c.is_active || filters.inactive)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {!c.is_active ? " (사용 중지)" : ""}
              </option>
            ))}
        </select>
        <select
          aria-label="배포 상태 필터"
          value={filters.deployment}
          onChange={(e) => change("deployment", e.target.value)}
        >
          <option value="">전체 배포 상태</option>
          <option value="untested">테스트 미반영</option>
          <option value="pending">테스트 반영 · 운영 미반영</option>
          <option value="production">운영 반영</option>
          <option value="unnecessary">배포 불필요</option>
        </select>
      </div>
      <details className="filter-more">
        <summary>
          상세 필터
          {filters.from ||
          filters.to ||
          filters.author ||
          filters.archived ||
          filters.inactive
            ? " · 적용 중"
            : ""}
        </summary>
        <div className="filter-secondary">
          <label>
            요청일 시작
            <input
              aria-label="요청일 시작"
              type="date"
              value={filters.from}
              max={filters.to || undefined}
              onChange={(e) => change("from", e.target.value)}
            />
          </label>
          <label>
            요청일 종료
            <input
              aria-label="요청일 종료"
              type="date"
              value={filters.to}
              min={filters.from || undefined}
              onChange={(e) => change("to", e.target.value)}
            />
          </label>
          <label>
            작성자
            <select
              value={filters.author}
              onChange={(e) => change("author", e.target.value)}
            >
              <option value="">전체 작성자</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.display_name}
                </option>
              ))}
            </select>
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={!!filters.inactive}
              onChange={(e) =>
                change("inactive", e.target.checked ? "true" : "")
              }
            />
            사용 중지 고객사 포함
          </label>
          {profile?.role === "admin" && (
            <label className="check">
              <input
                type="checkbox"
                checked={!!filters.archived}
                onChange={(e) =>
                  change("archived", e.target.checked ? "true" : "")
                }
              />
              보관함
            </label>
          )}
        </div>
      </details>
      {Object.values(filters).some(Boolean) && (
        <button
          type="button"
          className="filter-reset"
          onClick={() => change("reset", "")}
        >
          필터 초기화
        </button>
      )}
    </div>
  );
}
