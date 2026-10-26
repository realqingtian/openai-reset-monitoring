/* 主题：浅色 / 深色 / 跟随系统，偏好本地记忆（键与旧面板一致 crm-theme）。
   首屏防闪烁的内联脚本已在 index.html 里先行设置 data-theme，这里负责后续切换与跟随系统。 */

import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";

export type ThemeMode = "light" | "dark" | "system";

const THEME_KEY = "crm-theme";
const mqLight = matchMedia("(prefers-color-scheme: light)");
const subscribeSystemTheme = (notify: () => void) => {
  mqLight.addEventListener("change", notify);
  return () => mqLight.removeEventListener("change", notify);
};

function resolve(mode: ThemeMode): "light" | "dark" {
  return mode === "system" ? (mqLight.matches ? "light" : "dark") : mode;
}

function apply(mode: ThemeMode): "light" | "dark" {
  const resolved = resolve(mode);
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
  syncBrowserTheme();
  return resolved;
}

/* 让支持 theme-color 的浏览器与页面底色一致；站点图标自带底色，不随页面主题换图。 */
function syncBrowserTheme() {
  const meta = document.getElementById("browserTheme") as HTMLMetaElement | null;
  if (meta) meta.content = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
}

interface ThemeCtx {
  mode: ThemeMode;
  resolved: "light" | "dark";
  setMode: (m: ThemeMode) => void;
}

const Ctx = createContext<ThemeCtx | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(() => {
    try {
      const s = localStorage.getItem(THEME_KEY);
      if (s === "light" || s === "dark" || s === "system") return s;
    } catch {
      /* ignore */
    }
    return "light";
  });

  useEffect(() => {
    apply(mode);
    try {
      localStorage.setItem(THEME_KEY, mode);
    } catch {
      /* ignore */
    }
    if (mode !== "system") return;
    const onChange = () => { apply("system"); };
    mqLight.addEventListener?.("change", onChange);
    return () => mqLight.removeEventListener?.("change", onChange);
  }, [mode]);

  const systemLight = useSyncExternalStore(subscribeSystemTheme, () => mqLight.matches);
  const resolved = mode === "system" ? (systemLight ? "light" : "dark") : mode;
  const value = useMemo(() => ({ mode, resolved, setMode: setModeState }), [mode, resolved]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// oxlint-disable-next-line react/only-export-components -- context 文件同时导出 Provider 与 Hook
export function useTheme(): ThemeCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
