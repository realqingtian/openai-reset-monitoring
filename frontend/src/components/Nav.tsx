/* 主题与语言直接显示在同一菜单，选择即应用并关闭，避免偏好设置层级。 */

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { SVG_REFRESH } from "./icons";
import { ApiError, j } from "../api/client";
import type { Status } from "../api/types";
import { useAuth } from "../context/AuthContext";
import { useTheme, type ThemeMode } from "../context/ThemeContext";
import { useToast } from "../context/ToastContext";
import { NAV_CHECK, NAV_USER_ROUND, NAV_SUN, NAV_MOON, NAV_MONITOR, NAV_LOADER_CIRCLE, NAV_LOG_IN, NAV_LOG_OUT } from "./nav-icons";
import { useLangMode } from "../i18n/LangModeContext";

const THEMES: { mode: ThemeMode; label: string; icon: string }[] = [
  { mode: "light", label: "navLight", icon: NAV_SUN },
  { mode: "dark", label: "navDark", icon: NAV_MOON },
  { mode: "system", label: "systemMode", icon: NAV_MONITOR },
];

function StaticIcon({ svg }: { svg: string }) {
  return <span className="ui-icon" aria-hidden="true" dangerouslySetInnerHTML={{ __html: svg }} />;
}

interface NavProps {
  status: Status | null;
  onCheckDone: () => Promise<void>;
  refreshing: boolean;
}

export function Nav({ status, onCheckDone, refreshing }: NavProps) {
  const { t } = useTranslation();
  const { langMode, setLangMode } = useLangMode();
  const { mode: themeMode, resolved: resolvedTheme, setMode: setThemeMode } = useTheme();
  const { toast } = useToast();
  const auth = useAuth();
  const [checking, setChecking] = useState(false);
  const [updated, setUpdated] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  // 只有键盘导航依赖焦点管理；触屏焦点可能落到 body，不能据此提前卸载待点击的选项。
  const lastPointerType = useRef("");
  const accountBox = useRef<HTMLDivElement>(null);
  const checkTrigger = useRef<HTMLButtonElement>(null);
  const restoreCheckFocus = useRef(false);
  const accountTrigger = useRef<HTMLButtonElement>(null);
  const updatedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (updatedTimer.current) clearTimeout(updatedTimer.current); }, []);

  useEffect(() => {
    const record = (event: Event) => {
      const pointerType = (event as PointerEvent).pointerType;
      lastPointerType.current = event.type === "keydown" ? "keyboard" : pointerType || (event.type === "touchstart" ? "touch" : "");
    };
    document.addEventListener("pointerdown", record, { passive: true });
    document.addEventListener("touchstart", record, { passive: true });
    document.addEventListener("keydown", record, { passive: true });
    return () => {
      document.removeEventListener("pointerdown", record);
      document.removeEventListener("touchstart", record);
      document.removeEventListener("keydown", record);
    };
  }, []);

  useEffect(() => {
    if (!checking && restoreCheckFocus.current) {
      restoreCheckFocus.current = false;
      // 登录弹窗关闭时检查按钮仍禁用，等 React 恢复按钮后再归还焦点；触屏归还焦点会引发滚动跳位。
      if (lastPointerType.current !== "touch" && document.activeElement === document.body) checkTrigger.current?.focus();
    }
  }, [checking]);

  useEffect(() => {
    if (!menuOpen) return;
    if (lastPointerType.current === "keyboard") {
      accountBox.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus({ preventScroll: true });
    }
    // pointerdown 与 touchstart 双监听：不支持 PointerEvent 的老 WebView 也能点外部收口。
    const onOutside = (event: Event) => {
      // 使用事件路径，避免选项切换时 DOM 卸载被误判为点击外部。
      if (!event.composedPath().includes(accountBox.current as EventTarget)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", onOutside);
    document.addEventListener("touchstart", onOutside);
    return () => {
      document.removeEventListener("pointerdown", onOutside);
      document.removeEventListener("touchstart", onOutside);
    };
  }, [menuOpen]);

  function closeMenu(restoreFocus = true) {
    setMenuOpen(false);
    if (restoreFocus && lastPointerType.current === "keyboard") accountTrigger.current?.focus({ preventScroll: true });
  }

  function navigateMenu(event: KeyboardEvent<HTMLDivElement>) {
    lastPointerType.current = "keyboard";
    if (event.key === "Tab" && menuOpen) { closeMenu(); return; }
    if (!menuOpen && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      setMenuOpen(true);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeMenu();
      return;
    }
    const target = event.target as HTMLElement;
    const menu = target.closest('[role="menu"]');
    if (!menu) return;
    const items = Array.from(menu.querySelectorAll<HTMLButtonElement>("button")).filter((item) => item.closest('[role="menu"]') === menu);
    const current = items.indexOf(target as HTMLButtonElement);
    const next = event.key === "ArrowDown" ? (current + 1) % items.length : event.key === "ArrowUp" ? (current - 1 + items.length) % items.length : event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : null;
    if (next != null) { event.preventDefault(); items[next]?.focus(); }
  }

  async function checkNow() {
    restoreCheckFocus.current = true;
    if (updatedTimer.current) clearTimeout(updatedTimer.current);
    setUpdated(false);
    setChecking(true);
    closeMenu(false);
    try {
      await auth.guard(() => j("/api/poll-now", { method: "POST" }));
      await onCheckDone();
      setUpdated(true);
      updatedTimer.current = setTimeout(() => setUpdated(false), 2000);
      toast(t("toastDone"));
    } catch (e) {
      const authFail = e instanceof ApiError && e.auth;
      toast(authFail ? t("toastNeedLogin") : t("toastCheckFail", { e: (e as Error).message }), false);
    } finally {
      setChecking(false);
    }
  }

  const siteName = status?.site_name || "Codex Reset Monitor";
  const signedIn = auth.required && auth.loggedIn;
  const identity = signedIn ? auth.user : t(auth.required ? "navGuest" : "navPreferencesTitle");
  const checkLabel = t(checking ? "checking" : updated ? "navUpdated" : "check");
  const avatar = signedIn ? (auth.user || "A").slice(0, 1).toUpperCase() : null;

  const themeOptions = THEMES.map(({ mode, label, icon }) => (
    <button className="nav-preference-choice" key={mode} type="button" role="menuitemradio" aria-label={t(label)} aria-checked={themeMode === mode} onClick={() => { setThemeMode(mode); closeMenu(); }}>
      <span className="nav-choice-mark">{themeMode === mode && <StaticIcon svg={NAV_CHECK} />}</span><span className="nav-choice-label">{t(label)}</span><StaticIcon svg={icon} />
    </button>
  ));
  const languageOptions = (["zh", "en", "auto"] as const).map(mode => (
    <button className="nav-preference-choice" key={mode} type="button" role="menuitemradio" aria-checked={langMode === mode} onClick={() => { setLangMode(mode); closeMenu(); }}>
      <span className="nav-choice-mark">{langMode === mode && <StaticIcon svg={NAV_CHECK} />}</span><span className="nav-choice-label">{t(mode === "zh" ? "langZh" : mode === "en" ? "langEn" : "langAutoMenu")}</span>
    </button>
  ));

  return (
    <header className="nav nav--focused">
      <div className={"panel-progress" + (refreshing ? " active" : "")} aria-hidden><span /></div>
      <nav className="nav-inner" aria-label={t("panelNavigation")}>
        <div className="brand">
          <span className="brand-logo" aria-hidden>
            <img className="brand-blossom--light" src="/assets/openai-blossom-black.svg" width={36} height={36} alt="" />
            <img className="brand-blossom--dark" src="/assets/openai-blossom-white.svg" width={36} height={36} alt="" />
          </span>
          <div className="brand-copy">
            <span className="brand-name" title={siteName}>{siteName}</span>
            {status?.demo && <span className="badge-demo">{t("demoLabel")}</span>}
          </div>
        </div>
        <div className="nav-actions">
          <button ref={checkTrigger} className={"btn btn-primary nav-check" + (checking ? " loading" : "") + (updated ? " updated" : "")} type="button" aria-label={checkLabel} title={checkLabel} aria-busy={checking} disabled={checking} onClick={() => void checkNow()}>
            <StaticIcon svg={checking ? NAV_LOADER_CIRCLE : updated ? NAV_CHECK : SVG_REFRESH} />
            <span className="nav-check-desktop" aria-hidden>{checkLabel}</span>
            <span className="nav-check-mobile" aria-hidden>{t(checking ? "navCheckingShort" : updated ? "navUpdated" : "navCheckShort")}</span>
          </button>
          <button className="nav-theme-trigger" type="button" aria-label={t(resolvedTheme === "dark" ? "navLight" : "navDark")} title={t(resolvedTheme === "dark" ? "navLight" : "navDark")} onClick={() => { setThemeMode(resolvedTheme === "dark" ? "light" : "dark"); closeMenu(false); }}><StaticIcon svg={resolvedTheme === "dark" ? NAV_SUN : NAV_MOON} /></button>
          <span className="sr-only" role="status">{checking || updated ? checkLabel : ""}</span>
          <div className="nav-account-box" ref={accountBox} onKeyDown={navigateMenu} onBlur={(event) => {
            // 指针交互只由外部点按收起；blur 只处理键盘 Tab 离开菜单。
            if (lastPointerType.current !== "keyboard") return;
            const next = event.relatedTarget as Node | null;
            if (next && !event.currentTarget.contains(next)) closeMenu(false);
          }}>
            <button ref={accountTrigger} className="nav-avatar-trigger" type="button" aria-label={t("navAccountMenu")} title={t("navAccountMenu")} aria-haspopup="menu" aria-expanded={menuOpen} aria-controls="nav-account-menu" onClick={() => setMenuOpen(open => !open)}>
              <span className="nav-avatar" aria-hidden>{avatar || <StaticIcon svg={auth.required ? NAV_USER_ROUND : NAV_MONITOR} />}</span>
            </button>
            {menuOpen && (
              <div id="nav-account-menu" className="nav-account-menu" role="menu" aria-label={t("navAccountMenu")}>
                <div className="nav-menu-identity" role="presentation">
                  <span className="nav-avatar" aria-hidden>{avatar || <StaticIcon svg={auth.required ? NAV_USER_ROUND : NAV_MONITOR} />}</span>
                  <div><strong>{identity}</strong><span>{t(signedIn ? "navAdmin" : auth.required ? "navLoginHint" : "navDisplayPreferences")}</span></div>
                </div>
                <div className="nav-menu-section nav-preference-section" role="group" aria-label={t("navAppearance")}>
                  <div className="nav-preference-heading" aria-hidden="true"><span>{t("navAppearance")}</span></div>
                  <div className="nav-preference-list">{themeOptions}</div>
                </div>
                <div className="nav-menu-section nav-preference-section" role="group" aria-label={t("navLanguage")}>
                  <div className="nav-preference-heading" aria-hidden="true"><span>{t("navLanguage")}</span></div>
                  <div className="nav-preference-list">{languageOptions}</div>
                </div>
                {auth.required && <div className="nav-menu-section" role="presentation">
                  <button className="nav-menu-row" type="button" role="menuitem" onClick={() => {
                    closeMenu();
                    if (signedIn) auth.logout(); else void auth.openLogin({ form: true });
                  }}><StaticIcon svg={signedIn ? NAV_LOG_OUT : NAV_LOG_IN} /><span className="nav-menu-label">{t(signedIn ? "loginLogout" : "loginBtnTip")}</span></button>
                </div>}
              </div>
            )}
          </div>
        </div>
      </nav>
    </header>
  );
}
