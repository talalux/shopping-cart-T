"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

type ToastCtx = { toast: (msg: string) => void; toastUndo: (msg: string, onUndo: () => void) => void };
const Ctx = createContext<ToastCtx>({ toast: () => {}, toastUndo: () => {} });

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<{ msg: string; show: boolean; undo: (() => void) | null }>({ msg: "", show: false, undo: null });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hide = useCallback(() => setState((s) => ({ ...s, show: false, undo: null })), []);
  const arm = useCallback((ms: number) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(hide, ms);
  }, [hide]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const toast = useCallback((msg: string) => { setState({ msg, show: true, undo: null }); arm(2600); }, [arm]);
  const toastUndo = useCallback((msg: string, onUndo: () => void) => { setState({ msg, show: true, undo: onUndo }); arm(5000); }, [arm]);

  return (
    <Ctx.Provider value={{ toast, toastUndo }}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className={`toast z-[60] max-w-[90vw] rounded-lg bg-stone-900 text-white text-sm px-4 py-2.5 shadow-lg ${state.show ? "show" : ""}`}
      >
        {state.undo ? (
          <>
            <span>{state.msg}</span> <span aria-hidden="true">·</span>{" "}
            <button
              data-undo
              onClick={() => { state.undo?.(); hide(); }}
              className="font-semibold underline underline-offset-2 text-emerald-300 min-h-[40px] px-1"
            >
              เลิกทำ
            </button>
          </>
        ) : (
          state.msg
        )}
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
