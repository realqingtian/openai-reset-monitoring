/* 登录弹窗：账密表单 / 已登录态管理（退出）两个视图。
   移植自旧面板 index.html 的 authMask 结构与 auth.js 的交互。 */

import { useState } from "react";
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

  async function submit() {
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
    <div className="auth-mask" role="dialog" aria-modal="true" onClick={(e) => e.target === e.currentTarget && onClose(false)}>
      <div className="card auth-card">
        <div className="card-core">
          <div className="sub-title">{t("loginTitle")}</div>
          <p className="auth-desc">{t("loginDesc")}</p>
          {mode === "login" ? (
            <div>
              <input
                className="auth-input"
                type="text"
                placeholder={t("loginUser")}
                value={username}
                autoComplete="username"
                spellCheck={false}
                onChange={(e) => setUsername(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    document.getElementById("loginPass")?.focus();
                  }
                }}
              />
              <input
                id="loginPass"
                className="auth-input"
                type="password"
                placeholder={t("loginPass")}
                value={password}
                autoComplete="current-password"
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void submit();
                  }
                }}
              />
              {err && <div className="auth-err">{err}</div>}
              <div className="auth-actions">
                <button className="btn btn-ghost" type="button" onClick={() => onClose(false)}>
                  {t("loginCancel")}
                </button>
                <button className="btn btn-primary" type="button" disabled={busy} onClick={() => void submit()}>
                  {t("loginSubmit")}
                </button>
              </div>
            </div>
          ) : (
            <div>
              <div className="auth-user">{t("loginWho", { user: getStoredUser() || "?" })}</div>
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
        </div>
      </div>
    </div>
  );
}
