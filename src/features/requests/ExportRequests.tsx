import { useEffect, useRef, useState } from "react";
import { useSession } from "../../app/Session";
import { listRequests } from "../../lib/api";
import { errorMessage, localDatetime } from "../../lib/domain";
import {
  collectExportRequests,
  createRequestWorkbook,
} from "../../lib/request-export";
import type { Filters } from "../../lib/types";
import { demo } from "../../lib/supabase";

export function ExportRequests({
  filters,
  disabled,
  notify,
}: {
  filters: Filters;
  disabled: boolean;
  notify: (message: string, error?: boolean) => void;
}) {
  const { customers, people } = useSession();
  const [exporting, setExporting] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  async function download() {
    if (exporting || disabled) return;
    setExporting(true);
    const snapshot = { ...filters },
      generatedAt = new Date();
    notify("현재 필터의 전체 요청을 엑셀로 준비하고 있습니다.");
    try {
      const rows = await collectExportRequests(
        (limit, offset) => listRequests(snapshot, null, limit, offset),
        (loaded, total) => {
          if (mounted.current)
            notify(
              `엑셀 준비 중 · ${loaded.toLocaleString()} / ${total.toLocaleString()}건`,
            );
        },
      );
      if (!mounted.current) return;
      if (!rows.length) {
        notify("현재 필터에 맞는 요청이 없어 다운로드하지 않았습니다.");
        return;
      }
      const blob = await createRequestWorkbook(
        rows,
        customers,
        people,
        snapshot,
        generatedAt,
        demo,
      );
      if (!mounted.current) return;
      const url = URL.createObjectURL(blob),
        link = document.createElement("a");
      const stamp = localDatetime(generatedAt.toISOString())
        .replace(/[-:]/g, "")
        .replace("T", "_");
      link.href = url;
      link.download = `TGS-Tracker_${demo ? "데모_" : ""}요청현황_${stamp}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      notify(
        `${rows.length.toLocaleString()}건의 엑셀 다운로드를 시작했습니다. 다운로드 폴더를 확인해주세요.`,
      );
    } catch (error) {
      if (mounted.current)
        notify(`엑셀 다운로드에 실패했습니다. ${errorMessage(error)}`, true);
    } finally {
      if (mounted.current) setExporting(false);
    }
  }
  return (
    <button
      className="quiet export-button"
      disabled={disabled || exporting}
      onClick={() => void download()}
      title="현재 필터에 맞는 전체 요청을 다운로드합니다. 내부 메모와 이미지는 제외합니다."
      aria-busy={exporting}
    >
      {exporting ? "엑셀 준비 중…" : "엑셀 다운로드"}
    </button>
  );
}
