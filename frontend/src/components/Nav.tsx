/* 顶部导航：品牌、主题段控（滑块）、语言下拉、登录徽标、立即检查、调试测试通知。 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError, j } from "../api/client";
import type { Status } from "../api/types";
import { useAuth } from "../context/AuthContext";
import { useTheme, type ThemeMode } from "../context/ThemeContext";
import { useToast } from "../context/ToastContext";
import { SVG_CHEV, SVG_CHECK, SVG_GLOBE, SVG_LOCK } from "./icons";
import { useLang } from "../i18n/useLang";
import { useLangMode } from "../i18n/LangModeContext";

const THEME_ORDER: ThemeMode[] = ["light", "dark", "system"];

const BRAND_PATH =
  "M474.123 209.81c11.525-34.577 7.569-72.423-10.838-103.904-27.696-48.168-83.433-72.94-137.794-61.414a127.14 127.14 0 00-95.475-42.49c-55.564 0-104.936 35.781-122.139 88.593-35.781 7.397-66.574 29.76-84.637 61.414-27.868 48.167-21.503 108.72 15.826 150.007-11.525 34.578-7.569 72.424 10.838 103.733 27.696 48.34 83.433 73.111 137.966 61.585 24.084 27.18 58.833 42.835 95.303 42.663 55.564 0 104.936-35.782 122.139-88.594 35.782-7.397 66.574-29.76 84.465-61.413 28.04-48.168 21.676-108.722-15.654-150.008v-.172zm-39.567-87.218c11.01 19.267 15.139 41.803 11.354 63.65-.688-.516-2.064-1.204-2.924-1.72l-101.152-58.49a16.965 16.965 0 00-16.687 0L206.621 194.5v-50.232l97.883-56.597c45.587-26.32 103.732-10.666 130.052 34.921zm-227.935 104.42l49.888-28.9 49.887 28.9v57.63l-49.887 28.9-49.888-28.9v-57.63zm23.223-191.81c22.364 0 43.867 7.742 61.07 22.02-.688.344-2.064 1.204-3.097 1.72L186.666 117.26c-5.161 2.925-8.258 8.43-8.258 14.45v136.934l-43.523-25.116V130.333c0-52.64 42.491-95.13 95.131-95.302l-.172.172zM52.14 168.697c11.182-19.268 28.557-34.062 49.544-41.803V247.14c0 6.02 3.097 11.354 8.258 14.45l118.354 68.295-43.695 25.288-97.711-56.425c-45.415-26.32-61.07-84.465-34.75-130.052zm26.665 220.71c-11.182-19.095-15.139-41.802-11.354-63.65.688.516 2.064 1.204 2.924 1.72l101.152 58.49a16.965 16.965 0 0016.687 0l118.354-68.467v50.232l-97.883 56.425c-45.587 26.148-103.732 10.665-130.052-34.75h.172zm204.54 87.39c-22.192 0-43.867-7.741-60.898-22.02a62.439 62.439 0 003.097-1.72l101.152-58.317c5.16-2.924 8.429-8.43 8.257-14.45V243.527l43.523 25.116v113.022c0 52.64-42.663 95.303-95.131 95.303v-.172zM461.22 343.303c-11.182 19.267-28.729 34.061-49.544 41.63V264.687c0-6.021-3.097-11.526-8.257-14.45L284.893 181.77l43.523-25.116 97.883 56.424c45.587 26.32 61.07 84.466 34.75 130.053l.172.172z";

function LightIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M4.8 4.8l1.4 1.4M17.8 17.8l1.4 1.4M19.2 4.8l-1.4 1.4M6.2 17.8l-1.4 1.4" />
    </svg>
  );
}
function DarkIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 13.2A7.5 7.5 0 0 1 10.8 4 7.5 7.5 0 1 0 20 13.2z" />
    </svg>
  );
}
function SystemIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4.5" width="18" height="12.5" rx="2" />
      <path d="M9 20.5h6M12 17v3.5" />
    </svg>
  );
}

interface NavProps {
  status: Status | null;
  onCheckDone: () => void;
}

export function Nav({ status, onCheckDone }: NavProps) {
  const { t } = useTranslation();
  const lang = useLang();
  const { langMode, setLangMode } = useLangMode();
  const { mode: themeMode, setMode: setThemeMode } = useTheme();
  const { toast } = useToast();
  const auth = useAuth();
  const [checking, setChecking] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const langBox = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLSpanElement>(null);

  // 语言下拉的 outside click / Escape 关闭
  useEffect(() => {
    if (!langOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (langBox.current && !langBox.current.contains(e.target as Node)) setLangOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setLangOpen(false);
    document.addEventListener("click", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [langOpen]);

  // 主题段控滑块：跟随激活项位置与宽度（跟随系统项文案更长，宽度不固定）
  useLayoutEffect(() => {
    const idx = THEME_ORDER.indexOf(themeMode);
    const btn = langBox.current?.parentElement?.parentElement?.querySelectorAll<HTMLElement>(".seg-item")[idx];
    if (thumbRef.current && btn) {
      thumbRef.current.style.width = `${btn.offsetWidth}px`;
      thumbRef.current.style.transform = `translateX(${btn.offsetLeft - 3}px)`;
    }
  }, [themeMode]);

  async function checkNow() {
    setChecking(true);
    try {
      await auth.guard(() => j("/api/poll-now", { method: "POST" }));
      onCheckDone();
      toast(t("toastDone"));
    } catch (e) {
      const authFail = e instanceof ApiError && e.auth;
      toast(authFail ? t("toastNeedLogin") : t("toastCheckFail", { e: (e as Error).message }), false);
    } finally {
      setChecking(false);
    }
  }

  async function testNotify() {
    try {
      const results = await auth.guard(() =>
        j<{ channel: string; ok: boolean; error?: string }[]>("/api/test-notify", { method: "POST" }),
      );
      if (!results.length) {
        toast(t("toastNoChannel"), false);
        return;
      }
      const fails = results.filter((r) => !r.ok);
      const chs = results.map((r) => r.channel).join(lang === "zh" ? "、" : ", ");
      toast(
        fails.length
          ? t("toastSendFail", { e: fails.map((f) => f.channel).join(", ") + (fails[0].error ? " " + fails[0].error : "") })
          : t("toastSent", { n: results.length, chs }),
        !fails.length,
      );
    } catch (e) {
      const authFail = e instanceof ApiError && e.auth;
      toast(authFail ? t("toastNeedLogin") : t("toastSendFail", { e: (e as Error).message }), false);
    }
  }

  const langLabel = langMode === "zh" ? "中文" : langMode === "en" ? "English" : t("langAutoShort");
  const siteName = status?.site_name || "Codex Reset Monitor";

  return (
    <header className="nav">
      <div className="nav-inner">
        <div className="brand">
          <span className="brand-logo" aria-hidden>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" fillRule="evenodd" clipRule="evenodd" strokeLinejoin="round" strokeMiterlimit={2}>
              <path d={BRAND_PATH} fillRule="nonzero" fill="currentColor" />
            </svg>
          </span>
          <span className="pulse-dot green dim" />
          <span className="brand-name">{siteName}</span>
          {status?.demo && <span className="badge-demo">DEMO</span>}
        </div>
        <div className="nav-actions">
          {auth.required && (
            <button
              className={"lock-btn" + (auth.loggedIn ? " has-user" : "")}
              type="button"
              title={auth.loggedIn ? t("loginWho", { user: auth.user || "?" }) : t("loginBtnTip")}
              onClick={() => void auth.openLogin()}
            >
              {!auth.loggedIn && <span dangerouslySetInnerHTML={{ __html: SVG_LOCK }} />}
              {auth.loggedIn && <span className="pulse-dot green dim" />}
              {auth.loggedIn && <span className="uname">{auth.user || "?"}</span>}
            </button>
          )}
          <div className="seg" role="tablist" aria-label="Theme">
            <span className="seg-thumb" aria-hidden ref={thumbRef} />
            <button className={"seg-item icon-only" + (themeMode === "light" ? " active" : "")} type="button" title={t("lightMode")} onClick={() => setThemeMode("light")}>
              <LightIcon />
            </button>
            <button className={"seg-item icon-only" + (themeMode === "dark" ? " active" : "")} type="button" title={t("darkMode")} onClick={() => setThemeMode("dark")}>
              <DarkIcon />
            </button>
            <button className={"seg-item icon-only" + (themeMode === "system" ? " active" : "")} type="button" title={t("systemMode")} onClick={() => setThemeMode("system")}>
              <SystemIcon />
            </button>
          </div>
          <div className="dropdown" ref={langBox}>
            <button className="drop-trigger" type="button" aria-haspopup="listbox" aria-expanded={langOpen} onClick={() => setLangOpen((o) => !o)}>
              <span dangerouslySetInnerHTML={{ __html: SVG_GLOBE }} />
              <span>{langLabel}</span>
              <span dangerouslySetInnerHTML={{ __html: SVG_CHEV }} />
            </button>
            {langOpen && (
              <div className="drop-menu open" role="listbox">
                {(["zh", "en", "auto"] as const).map((m) => (
                  <button
                    key={m}
                    className={"drop-item" + (langMode === m ? " active" : "")}
                    type="button"
                    role="option"
                    onClick={() => {
                      setLangMode(m);
                      setLangOpen(false);
                    }}
                  >
                    <span>{m === "zh" ? "中文" : m === "en" ? "English" : t("langAutoMenu")}</span>
                    <span dangerouslySetInnerHTML={{ __html: SVG_CHECK }} />
                  </button>
                ))}
              </div>
            )}
          </div>
          <button className="btn btn-primary" type="button" disabled={checking} onClick={() => void checkNow()}>
            <span>{checking ? t("checking") : t("check")}</span>
            <span className="btn-orb">
              {checking ? (
                <svg className="ico-spin" viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                  <path d="M14.5 8A6.5 6.5 0 1 1 8 1.5" />
                </svg>
              ) : (
                <svg className="ico-arrow" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
                  <path d="M21 3v5h-5" />
                </svg>
              )}
            </span>
          </button>
          {status?.debug && (
            <button className="btn btn-ghost" type="button" title={t("debugBtnTip")} onClick={() => void testNotify()}>
              {t("testNotify")}
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
