/* 主题：浅色 / 深色 / 跟随系统，偏好本地记忆（键与旧面板一致 crm-theme）。
   首屏防闪烁的内联脚本已在 index.html 里先行设置 data-theme，这里负责后续切换与跟随系统。 */

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type ThemeMode = "light" | "dark" | "system";

const THEME_KEY = "crm-theme";
const mqLight = matchMedia("(prefers-color-scheme: light)");

function resolve(mode: ThemeMode): "light" | "dark" {
  return mode === "system" ? (mqLight.matches ? "light" : "dark") : mode;
}

function apply(mode: ThemeMode): "light" | "dark" {
  const resolved = resolve(mode);
  document.documentElement.dataset.theme = resolved;
  return resolved;
}

/* 深浅主题各自配套 favicon（浅色用深色图形版），跟随主题同步 */
function syncFavicon(resolved: "light" | "dark") {
  const svg = document.getElementById("favSvg") as HTMLLinkElement | null;
  const png = document.getElementById("favPng") as HTMLLinkElement | null;
  if (svg) svg.href = resolved === "dark" ? "/assets/favicon-dark.svg" : "/assets/favicon.svg";
  if (png) png.href = resolved === "dark" ? "/assets/favicon-dark-32x32.png" : "/assets/favicon-32x32.png";
}

interface ThemeCtx {
  mode: ThemeMode;
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
    return "system";
  });

  useEffect(() => {
    syncFavicon(apply(mode));
    try {
      localStorage.setItem(THEME_KEY, mode);
    } catch {
      /* ignore */
    }
    if (mode !== "system") return;
    const onChange = () => syncFavicon(apply("system"));
    mqLight.addEventListener?.("change", onChange);
    return () => mqLight.removeEventListener?.("change", onChange);
  }, [mode]);

  const value = useMemo(() => ({ mode, setMode: setModeState }), [mode]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// oxlint-disable-next-line react/only-export-components -- context 文件同时导出 Provider 与 Hook
export function useTheme(): ThemeCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
