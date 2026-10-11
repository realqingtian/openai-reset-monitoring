/* 检查优先：账户菜单集中偏好与登录操作，手机端子菜单内联。 */

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { ApiError, j } from "../api/client";
import type { Status } from "../api/types";
import { useAuth } from "../context/AuthContext";
import { useTheme, type ThemeMode } from "../context/ThemeContext";
import { useToast } from "../context/ToastContext";
import { NAV_CHECK, NAV_GLOBE, NAV_USER_ROUND, NAV_SUN, NAV_MOON, NAV_MONITOR, NAV_REFRESH_CW, NAV_LOADER_CIRCLE, NAV_CHEVRON_RIGHT, NAV_LOG_IN, NAV_LOG_OUT } from "./nav-icons";
import { useLangMode } from "../i18n/LangModeContext";

const THEMES: { mode: ThemeMode; label: string; icon: string }[] = [
  { mode: "light", label: "navLight", icon: NAV_SUN },
  { mode: "dark", label: "navDark", icon: NAV_MOON },
  { mode: "system", label: "systemMode", icon: NAV_MONITOR },
];

const BRAND_PATH =
  "M474.123 209.81c11.525-34.577 7.569-72.423-10.838-103.904-27.696-48.168-83.433-72.94-137.794-61.414a127.14 127.14 0 00-95.475-42.49c-55.564 0-104.936 35.781-122.139 88.593-35.781 7.397-66.574 29.76-84.637 61.414-27.868 48.167-21.503 108.72 15.826 150.007-11.525 34.578-7.569 72.424 10.838 103.733 27.696 48.34 83.433 73.111 137.966 61.585 24.084 27.18 58.833 42.835 95.303 42.663 55.564 0 104.936-35.782 122.139-88.594 35.782-7.397 66.574-29.76 84.465-61.413 28.04-48.168 21.676-108.722-15.654-150.008v-.172zm-39.567-87.218c11.01 19.267 15.139 41.803 11.354 63.65-.688-.516-2.064-1.204-2.924-1.72l-101.152-58.49a16.965 16.965 0 00-16.687 0L206.621 194.5v-50.232l97.883-56.597c45.587-26.32 103.732-10.666 130.052 34.921zm-227.935 104.42l49.888-28.9 49.887 28.9v57.63l-49.887 28.9-49.888-28.9v-57.63zm23.223-191.81c22.364 0 43.867 7.742 61.07 22.02-.688.344-2.064 1.204-3.097 1.72L186.666 117.26c-5.161 2.925-8.258 8.43-8.258 14.45v136.934l-43.523-25.116V130.333c0-52.64 42.491-95.13 95.131-95.302l-.172.172zM52.14 168.697c11.182-19.268 28.557-34.062 49.544-41.803V247.14c0 6.02 3.097 11.354 8.258 14.45l118.354 68.295-43.695 25.288-97.711-56.425c-45.415-26.32-61.07-84.465-34.75-130.052zm26.665 220.71c-11.182-19.095-15.139-41.802-11.354-63.65.688.516 2.064 1.204 2.924 1.72l101.152 58.49a16.965 16.965 0 0016.687 0l118.354-68.467v50.232l-97.883 56.425c-45.587 26.148-103.732 10.665-130.052-34.75h.172zm204.54 87.39c-22.192 0-43.867-7.741-60.898-22.02a62.439 62.439 0 003.097-1.72l101.152-58.317c5.16-2.924 8.429-8.43 8.257-14.45V243.527l43.523 25.116v113.022c0 52.64-42.663 95.303-95.131 95.303v-.172zM461.22 343.303c-11.182 19.267-28.729 34.061-49.544 41.63V264.687c0-6.021-3.097-11.526-8.257-14.45L284.893 181.77l43.523-25.116 97.883 56.424c45.587 26.32 61.07 84.466 34.75 130.053l.172.172z";

function StaticIcon({ svg }: { svg: string }) {
  return <span className="ui-icon" aria-hidden="true" dangerouslySetInnerHTML={{ __html: svg }} />;
}

interface NavProps {
  status: Status | null;
  onCheckDone: () => Promise<void>;
  refreshing: boolean;
}

type Submenu = "appearance" | "language" | null;

export function Nav({ status, onCheckDone, refreshing }: NavProps) {
  const { t } = useTranslation();
  const { langMode, setLangMode } = useLangMode();
  const { mode: themeMode, setMode: setThemeMode } = useTheme();
  const { toast } = useToast();
  const auth = useAuth();
  const [checking, setChecking] = useState(false);
  const [updated, setUpdated] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [submenu, setSubmenu] = useState<Submenu>(null);
  const accountBox = useRef<HTMLDivElement>(null);
  const checkTrigger = useRef<HTMLButtonElement>(null);
  const restoreCheckFocus = useRef(false);
  const accountTrigger = useRef<HTMLButtonElement>(null);
  const appearanceTrigger = useRef<HTMLButtonElement>(null);
  const languageTrigger = useRef<HTMLButtonElement>(null);
  const updatedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (updatedTimer.current) clearTimeout(updatedTimer.current); }, []);

  useEffect(() => {
    if (!checking && restoreCheckFocus.current) {
      restoreCheckFocus.current = false;
      // 登录弹窗关闭时检查按钮仍禁用，等 React 恢复按钮后再归还焦点。
      if (document.activeElement === document.body) checkTrigger.current?.focus();
    }
  }, [checking]);

  useEffect(() => {
    if (!menuOpen) return;
    accountBox.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    const onOutside = (event: PointerEvent) => {
      // 使用事件路径，避免选项切换时 DOM 卸载被误判为点击外部。
      if (!event.composedPath().includes(accountBox.current as EventTarget)) {
        setMenuOpen(false);
        setSubmenu(null);
      }
    };
    document.addEventListener("pointerdown", onOutside);
    return () => document.removeEventListener("pointerdown", onOutside);
  }, [menuOpen]);

  useEffect(() => {
    if (submenu) accountBox.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
  }, [submenu]);

  function closeMenu(restoreFocus = true) {
    setMenuOpen(false);
    setSubmenu(null);
    if (restoreFocus) accountTrigger.current?.focus();
  }

  function closeSubmenu() {
    (submenu === "appearance" ? appearanceTrigger : languageTrigger).current?.focus();
    setSubmenu(null);
  }

  function navigateMenu(event: KeyboardEvent<HTMLDivElement>) {
    if (!menuOpen && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      setMenuOpen(true);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (submenu) closeSubmenu(); else closeMenu();
      return;
    }
    const target = event.target as HTMLElement;
    const menu = target.closest('[role="menu"]');
    if (!menu) return;
    if (event.key === "ArrowLeft" && submenu) { event.preventDefault(); closeSubmenu(); return; }
    if (event.key === "ArrowRight" && target.hasAttribute("aria-controls")) {
      event.preventDefault();
      setSubmenu(target === appearanceTrigger.current ? "appearance" : "language");
      return;
    }
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

  const langLabel = langMode === "zh" ? t("langZh") : langMode === "en" ? t("langEn") : t("langAutoShort");
  const themeLabel = t(THEMES.find(({ mode }) => mode === themeMode)!.label);
  const siteName = status?.site_name || "Codex Reset Monitor";
  const signedIn = auth.required && auth.loggedIn;
  const identity = signedIn ? auth.user : t(auth.required ? "navGuest" : "navPreferencesTitle");
  const checkLabel = t(checking ? "checking" : updated ? "navUpdated" : "check");
  const avatar = signedIn ? (auth.user || "A").slice(0, 1).toUpperCase() : null;

  return (
    <header className="nav nav--focused">
      <div className={"panel-progress" + (refreshing ? " active" : "")} aria-hidden><span /></div>
      <nav className="nav-inner" aria-label={t("panelNavigation")}>
        <div className="brand">
          <span className="brand-logo" aria-hidden>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" fillRule="evenodd" clipRule="evenodd" strokeLinejoin="round" strokeMiterlimit={2}>
              <path d={BRAND_PATH} fillRule="nonzero" fill="currentColor" />
            </svg>
          </span>
          <div className="brand-copy">
            <span className="brand-name" title={siteName}>{siteName}</span>
            {status?.demo && <span className="badge-demo">{t("demoLabel")}</span>}
          </div>
        </div>
        <div className="nav-actions">
          <button ref={checkTrigger} className={"btn btn-primary nav-check" + (checking ? " loading" : "") + (updated ? " updated" : "")} type="button" aria-label={checkLabel} title={checkLabel} aria-busy={checking} disabled={checking} onClick={() => void checkNow()}>
            <StaticIcon svg={checking ? NAV_LOADER_CIRCLE : updated ? NAV_CHECK : NAV_REFRESH_CW} />
            <span className="nav-check-desktop" aria-hidden>{checkLabel}</span>
            <span className="nav-check-mobile" aria-hidden>{t(checking ? "navCheckingShort" : updated ? "navUpdated" : "navCheckShort")}</span>
          </button>
          <span className="sr-only" role="status">{checking || updated ? checkLabel : ""}</span>
          <div className="nav-account-box" ref={accountBox} onKeyDown={navigateMenu} onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) { setMenuOpen(false); setSubmenu(null); }
          }}>
            <button ref={accountTrigger} className="nav-avatar-trigger" type="button" aria-label={t("navAccountMenu")} title={t("navAccountMenu")} aria-haspopup="menu" aria-expanded={menuOpen} aria-controls="nav-account-menu" onClick={() => { setMenuOpen((open) => !open); setSubmenu(null); }}>
              <span className="nav-avatar" aria-hidden>{avatar || <StaticIcon svg={auth.required ? NAV_USER_ROUND : NAV_MONITOR} />}</span>
            </button>
            {menuOpen && (
              <div id="nav-account-menu" className="nav-account-menu" role="menu" aria-label={t("navAccountMenu")}>
                <div className="nav-menu-identity" role="presentation">
                  <span className="nav-avatar" aria-hidden>{avatar || <StaticIcon svg={auth.required ? NAV_USER_ROUND : NAV_MONITOR} />}</span>
                  <div><strong>{identity}</strong><span>{t(signedIn ? "navAdmin" : auth.required ? "navLoginHint" : "navDisplayPreferences")}</span></div>
                </div>
                <div className="nav-menu-section" role="presentation">
                  <div className="nav-submenu-anchor" role="presentation">
                    <button ref={appearanceTrigger} className="nav-menu-row" type="button" role="menuitem" aria-haspopup="menu" aria-expanded={submenu === "appearance"} aria-controls="nav-appearance-menu" onClick={() => setSubmenu((open) => open === "appearance" ? null : "appearance")}>
                      <StaticIcon svg={NAV_SUN} /><span className="nav-menu-label">{t("navAppearance")}</span><span className="nav-menu-value">{themeLabel}</span><span className="nav-menu-chevron"><StaticIcon svg={NAV_CHEVRON_RIGHT} /></span>
                    </button>
                    {submenu === "appearance" && (
                      <div id="nav-appearance-menu" className="nav-submenu" role="menu" aria-label={t("themeLabel")}>
                        {THEMES.map(({ mode, label, icon }) => (
                          <button className="nav-menu-row" key={mode} type="button" role="menuitemradio" aria-checked={themeMode === mode} onClick={() => { setThemeMode(mode); closeSubmenu(); }}>
                            <StaticIcon svg={icon} /><span className="nav-menu-label">{t(label)}</span>{themeMode === mode && <span className="nav-selected"><StaticIcon svg={NAV_CHECK} /></span>}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="nav-submenu-anchor" role="presentation">
                    <button ref={languageTrigger} className="nav-menu-row" type="button" role="menuitem" aria-haspopup="menu" aria-expanded={submenu === "language"} aria-controls="nav-language-menu" onClick={() => setSubmenu((open) => open === "language" ? null : "language")}>
                      <StaticIcon svg={NAV_GLOBE} /><span className="nav-menu-label">{t("navLanguage")}</span><span className="nav-menu-value">{langLabel}</span><span className="nav-menu-chevron"><StaticIcon svg={NAV_CHEVRON_RIGHT} /></span>
                    </button>
                    {submenu === "language" && (
                      <div id="nav-language-menu" className="nav-submenu" role="menu" aria-label={t("langSwitch")}>
                        {(["zh", "en", "auto"] as const).map((mode) => (
                          <button className="nav-menu-row" key={mode} type="button" role="menuitemradio" aria-checked={langMode === mode} onClick={() => { setLangMode(mode); closeSubmenu(); }}>
                            <StaticIcon svg={NAV_GLOBE} /><span className="nav-menu-label">{t(mode === "zh" ? "langZh" : mode === "en" ? "langEn" : "langAutoMenu")}</span>{langMode === mode && <span className="nav-selected"><StaticIcon svg={NAV_CHECK} /></span>}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                {auth.required && (
                  <div className="nav-menu-section" role="presentation">
                    <button className="nav-menu-row" type="button" role="menuitem" onClick={() => {
                      closeMenu();
                      if (signedIn) auth.logout(); else void auth.openLogin({ form: true });
                    }}><StaticIcon svg={signedIn ? NAV_LOG_OUT : NAV_LOG_IN} /><span className="nav-menu-label">{t(signedIn ? "loginLogout" : "loginBtnTip")}</span></button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </nav>
    </header>
  );
}
