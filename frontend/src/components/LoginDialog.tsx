/* 登录弹窗：账密表单 / 已登录态管理（退出）两个视图。
   移植自旧面板 index.html 的 authMask 结构与 auth.js 的交互。 */

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError, getStoredUser, j, saveSession } from "../api/client";
import { useAuth } from "../context/AuthContext";

export function LoginDialog({ forceForm, onClose }: { forceForm: boolean; onClose: (result: boolean) => void }) {
  const { t } = useTranslation();
  const { logout } = useAuth();
  const [mode] = useState<"login" | "state">(
    !!getStoredUser() && !!localStorage.getItem("crm-jwt") && !forceForm ? "state" : "login",
  );
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  // 原生模态层负责焦点圈定和背景不可操作，关闭后归还到触发按钮。
  useEffect(() => {
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement as HTMLElement | null;
    dialog?.showModal();
    return () => {
      dialog?.close();
      // React 先移除 dialog 再执行 effect 清理，需显式把焦点还给触发按钮。
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  async function submit() {
    if (busy) return;
    if (!username.trim() || !password) {
      setErr(t("loginErrEmpty"));
      return;
    }
    setBusy(true);
    try {
      const data = await j<{ access_token: string }>("/api/login", {
        method: "POST",
        body: JSON.stringify({ username: username.trim(), password }),
      });
      saveSession(data.access_token, username.trim());
      onClose(true);
    } catch (e) {
      setErr(e instanceof ApiError && e.auth ? t("loginErr") : t("loginErrNet", { e: (e as Error).message }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog ref={dialogRef} className="auth-dialog" aria-labelledby="authTitle" aria-describedby="authDescription" onCancel={(e) => { e.preventDefault(); onClose(false); }} onKeyDown={(e) => {
      if (e.key !== "Tab") return;
      const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('input:not(:disabled), button:not(:disabled)'));
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
      if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    }}>
          <h2 id="authTitle" className="section-heading">{t(mode === "login" ? "loginTitle" : "accountTitle")}</h2>
          <p id="authDescription" className="auth-desc">{mode === "login" ? t("loginDesc") : t("loginWho", { user: getStoredUser() || "?" })}</p>
          {mode === "login" ? (
            <form onSubmit={(e) => { e.preventDefault(); void submit(); }}>
              <label className="auth-label" htmlFor="loginUser">{t("loginUser")}</label>
              <input
                id="loginUser"
                className="auth-input"
                type="text"
                placeholder={t("loginUser")}
                value={username}
                autoComplete="username"
                spellCheck={false}
                aria-invalid={!!err}
                aria-describedby={err ? "loginError" : undefined}
                onChange={(e) => setUsername(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    document.getElementById("loginPass")?.focus();
                  }
                }}
              />
              <label className="auth-label" htmlFor="loginPass">{t("loginPass")}</label>
              <input
                id="loginPass"
                className="auth-input"
                type="password"
                placeholder={t("loginPass")}
                value={password}
                autoComplete="current-password"
                aria-invalid={!!err}
                aria-describedby={err ? "loginError" : undefined}
                onChange={(e) => setPassword(e.target.value)}
              />
              {err && <div id="loginError" className="auth-err" role="alert">{err}</div>}
              <div className="auth-actions">
                <button className="btn btn-ghost" type="button" onClick={() => onClose(false)}>
                  {t("loginCancel")}
                </button>
                <button className="btn btn-primary" type="submit" disabled={busy}>
                  {t(busy ? "loginSigningIn" : "loginSubmit")}
                </button>
              </div>
            </form>
          ) : (
            <div>
              <div className="auth-actions">
                <button
                  className="btn btn-ghost"
                  type="button"
                  onClick={() => {
                    logout();
                    onClose(false);
                  }}
                >
                  {t("loginLogout")}
                </button>
                <button className="btn btn-primary" type="button" onClick={() => onClose(false)}>
                  {t("loginClose")}
                </button>
              </div>
            </div>
          )}
    </dialog>
  );
}
