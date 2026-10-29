import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useSession } from "../../app/Session";
import { errorMessage, todayKST } from "../../lib/domain";
import { rpc, uploadAttachment } from "../../lib/api";
import type { RequestInput } from "../../lib/types";
import { Alert, PageTitle } from "../../components/UI";
import { ImagePicker } from "./Images";
import "./request-workspace.css";
export function NewRequest() {
  const { customers } = useSession(),
    active = customers.filter((c) => c.is_active),
    navigate = useNavigate();
  const [form, setForm] = useState<RequestInput>({
      customer_id: active.length === 1 ? active[0].id : "",
      title: "",
      description: "",
      requester_name: "",
      requested_on: todayKST(),
      requires_deployment: true,
    }),
    [files, setFiles] = useState<File[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [imagesBusy, setImagesBusy] = useState(false);
  function field<K extends keyof RequestInput>(key: K, value: RequestInput[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || imagesBusy || !active.length) return;
    setError("");
    setBusy(true);
    let id: string | undefined;
    try {
      id = await rpc<string>("create_request", { payload: form });
      let attachmentError = "";
      for (const file of files) {
        try {
          await uploadAttachment(id, file);
        } catch (e) {
          attachmentError = errorMessage(e);
          break;
        }
      }
      navigate(`/requests/${id}`, {
        replace: true,
        state: {
          notice: attachmentError
            ? `요청은 저장되었습니다. 일부 이미지는 저장하지 못했습니다: ${attachmentError}. 첨부 목록에서 확인하고 다시 첨부해주세요.`
            : "요청이 등록되었습니다.",
        },
      });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Link className="back-link" to="/board">
        ← 진행 현황
      </Link>
      <PageTitle
        eyebrow="NEW REQUEST"
        title="요청 등록"
        description="고객사의 요청과 확인에 필요한 화면을 함께 기록하세요."
      />
      {error && <Alert>{error}</Alert>}
      {!active.length && (
        <Alert tone="info">
          등록 가능한 고객사가 없습니다. 관리자에게 담당 고객사 배정을
          요청해주세요.
        </Alert>
      )}
      <form onSubmit={submit} className="request-create">
        <fieldset
          className="request-create-grid"
          disabled={busy || !active.length}
        >
          <section className="form-panel" aria-labelledby="request-info-title">
            <h2 id="request-info-title">요청 정보</h2>
            <p className="field-help">
              필수 항목을 입력하고, 오류 화면이 있다면 함께 첨부해주세요.
            </p>
            <div className="form-grid">
              <label>
                고객사 <em>*</em>
                <select
                  required
                  value={form.customer_id}
                  onChange={(e) => field("customer_id", e.target.value)}
                >
                  <option value="">고객사 선택</option>
                  {active.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                요청일 <em>*</em>
                <input
                  type="date"
                  required
                  value={form.requested_on}
                  onChange={(e) => field("requested_on", e.target.value)}
                />
              </label>
            </div>
            <label>
              제목 <em>*</em>
              <input
                required
                maxLength={150}
                value={form.title}
                onChange={(e) => field("title", e.target.value)}
                placeholder="어떤 요청인지 간단하게 적어주세요"
              />
            </label>
            <label>
              요청 내용 <em>*</em>
              <textarea
                required
                rows={8}
                maxLength={10000}
                value={form.description}
                onChange={(e) => field("description", e.target.value)}
                placeholder="현재 동작, 요청한 변경 내용, 확인 방법을 기록해주세요."
              />
            </label>
            <div className="form-grid">
              <label>
                고객사 요청자
                <input
                  maxLength={80}
                  value={form.requester_name}
                  onChange={(e) => field("requester_name", e.target.value)}
                  placeholder="선택 입력"
                />
              </label>
            </div>
          </section>
          <aside>
            <section
              className="form-panel"
              aria-labelledby="request-images-title"
            >
              <h2 id="request-images-title">
                첨부 이미지 <small>선택 · {files.length}/5</small>
              </h2>
              <ImagePicker
                files={files}
                onChange={setFiles}
                disabled={busy}
                onBusyChange={setImagesBusy}
              />
            </section>
            <section
              className="form-panel"
              aria-labelledby="request-deployment-title"
            >
              <h2 id="request-deployment-title">배포 설정</h2>
              <label className="check">
                <input
                  type="checkbox"
                  checked={form.requires_deployment}
                  onChange={(e) =>
                    field("requires_deployment", e.target.checked)
                  }
                />
                서버 배포가 필요한 요청
              </label>
              <p className="field-help">
                {form.requires_deployment
                  ? "테스트와 운영 반영 여부를 따로 기록합니다. 접수 단계로 등록되며 반영일은 등록 후 입력합니다."
                  : "문서 안내 등 서버 변경이 없는 요청입니다. 진행 상태만 관리합니다."}
              </p>
            </section>
            <div className="form-actions">
              <Link className="button" to="/board">
                취소
              </Link>
              <button
                className="primary"
                disabled={busy || imagesBusy || !active.length}
              >
                {busy
                  ? "요청과 이미지 저장 중…"
                  : imagesBusy
                    ? "이미지 준비 중…"
                    : "요청 등록"}
              </button>
            </div>
          </aside>
        </fieldset>
      </form>
    </>
  );
}
