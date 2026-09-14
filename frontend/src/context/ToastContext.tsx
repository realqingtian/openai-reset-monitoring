/* 轻量 toast：单条展示、4 秒自动消失、成功/错误两态。移植自旧面板 dom.js 的 toast。 */

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

interface ToastCtx {
  toast: (msg: string, ok?: boolean) => void;
}

const Ctx = createContext<ToastCtx | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [item, setItem] = useState<{ msg: string; ok: boolean; key: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toast = useCallback((msg: string, ok = true) => {
    if (timer.current) clearTimeout(timer.current);
    setItem({ msg, ok, key: Date.now() });
    timer.current = setTimeout(() => setItem(null), 4000);
  }, []);

  return (
    <Ctx.Provider value={{ toast }}>
      {children}
      {item && (
        <div key={item.key} className={item.ok ? "toast" : "toast err"} role="status">
          {item.msg}
        </div>
      )}
    </Ctx.Provider>
  );
}

// oxlint-disable-next-line react/only-export-components -- context 文件同时导出 Provider 与 Hook
export function useToast(): ToastCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
