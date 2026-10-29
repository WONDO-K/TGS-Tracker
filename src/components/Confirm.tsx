import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
type Options = {
  title: string;
  message: string;
  danger?: boolean;
  consent?: string;
  action?: string;
};
const Context = createContext<(options: Options) => Promise<boolean>>(null!);
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<Options | null>(null),
    [agreed, setAgreed] = useState(false),
    dialog = useRef<HTMLDialogElement>(null),
    resolver = useRef<((yes: boolean) => void) | null>(null);
  function finish(yes: boolean) {
    dialog.current?.close();
    resolver.current?.(yes);
    resolver.current = null;
    setOptions(null);
    setAgreed(false);
  }
  useEffect(() => {
    if (options && !dialog.current?.open) dialog.current?.showModal();
  }, [options]);
  const confirm = (value: Options) =>
    new Promise<boolean>((resolve) => {
      resolver.current?.(false);
      resolver.current = resolve;
      setAgreed(false);
      setOptions(value);
    });
  return (
    <Context.Provider value={confirm}>
      {children}
      <dialog
        className="confirm-dialog"
        ref={dialog}
        onCancel={(e) => {
          e.preventDefault();
          finish(false);
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) finish(false);
        }}
        aria-labelledby="confirmation-title"
        aria-describedby="confirmation-message"
      >
        <div
          className={`modal-symbol ${options?.danger ? "negative" : ""}`}
          aria-hidden="true"
        >
          {options?.danger ? "!" : "?"}
        </div>
        <h2 id="confirmation-title">{options?.title}</h2>
        <p id="confirmation-message">{options?.message}</p>
        {options?.consent && (
          <label className="check consent">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
            />
            {options.consent}
          </label>
        )}
        <div className="modal-actions">
          <button autoFocus onClick={() => finish(false)}>
            취소
          </button>
          <button
            className={options?.danger ? "primary destructive" : "primary"}
            disabled={!!options?.consent && !agreed}
            onClick={() => finish(true)}
          >
            {options?.action || "확인"}
          </button>
        </div>
      </dialog>
    </Context.Provider>
  );
}
export const useConfirm = () => useContext(Context);
