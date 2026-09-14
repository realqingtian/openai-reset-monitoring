/* JWT 登录态：Provider 持有会话与登录弹窗开关；guard() 包裹写操作实现
   401 → 弹账密表单 → 登录成功自动重试，仍被拒则提示过期并再次弹窗。
   移植自旧面板 auth.js + main.js 的 withAuthRetry。 */

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ApiError, clearSession, getStoredUser, getToken } from "../api/client";
import { LoginDialog } from "../components/LoginDialog";
import { useToast } from "./ToastContext";

interface AuthCtx {
  required: boolean; // 服务端开启了鉴权（MONITOR_ADMIN_PASSWORD 已配置）
  loggedIn: boolean;
  user: string;
  syncRequired: (v: boolean) => void;
  /** 弹登录入口；form=true 强制账密表单（401 引导场景）。resolve(true) 表示已登录可重试。 */
  openLogin: (opts?: { form?: boolean }) => Promise<boolean>;
  logout: () => void;
  /** 包裹写操作：401 时引导登录并自动重试。 */
  guard: <T>(fn: () => Promise<T>) => Promise<T>;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [required, setRequired] = useState(false);
  // session 版本号：登录/退出后递增，让 loggedIn/user 从 localStorage 重读
  const [sessionVersion, setSessionVersion] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [forceForm, setForceForm] = useState(false);
  // 弹窗的 Promise resolver 必须放 ref：组件重渲染不会丢（组件体变量会）
  const resolverRef = useRef<((v: boolean) => void) | null>(null);

  // sessionVersion 刻意入 deps：登录/退出后强制从 localStorage 重读
  // oxlint-disable-next-line react-hooks/exhaustive-deps
  const loggedIn = useMemo(() => !!getToken(), [sessionVersion]);
  // oxlint-disable-next-line react-hooks/exhaustive-deps
  const user = useMemo(() => getStoredUser(), [sessionVersion]);

  const openLogin = useCallback((opts?: { form?: boolean }) => {
    setForceForm(!!opts?.form);
    setDialogOpen(true);
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
    });
  }, []);

  const logout = useCallback(() => {
    clearSession();
    setSessionVersion((v) => v + 1);
  }, []);

  const handleDialogClose = useCallback((result: boolean) => {
    setDialogOpen(false);
    setSessionVersion((v) => v + 1); // 登录成功后刷新 loggedIn/user
    resolverRef.current?.(result);
    resolverRef.current = null;
  }, []);

  const syncRequired = useCallback((v: boolean) => setRequired(v), []);

  const guard = useCallback(
    async <T,>(fn: () => Promise<T>): Promise<T> => {
      let retried = false;
      for (;;) {
        try {
          return await fn();
        } catch (e) {
          if (!(e instanceof ApiError) || !e.auth) throw e;
          if (retried) toast(t("toastLoginExpired"), false);
          retried = true;
          const ok = await openLogin({ form: true });
          if (!ok) throw e;
        }
      }
    },
    [openLogin, t, toast],
  );

  const value = useMemo(
    () => ({ required, loggedIn, user, syncRequired, openLogin, logout, guard }),
    [required, loggedIn, user, syncRequired, openLogin, logout, guard],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      {dialogOpen && <LoginDialog forceForm={forceForm} onClose={handleDialogClose} />}
    </Ctx.Provider>
  );
}

// oxlint-disable-next-line react/only-export-components -- context 文件同时导出 Provider 与 Hook
export function useAuth(): AuthCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
