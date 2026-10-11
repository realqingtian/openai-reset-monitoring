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
  syncFavicon(resolved);
  return resolved;
}

/* 透明图标与页头标志一致：浅色纯黑、深色纯白，切换时同步更新。 */
function syncFavicon(resolved: "light" | "dark") {
  const svg = document.getElementById("favSvg") as HTMLLinkElement | null;
  const png = document.getElementById("favPng") as HTMLLinkElement | null;
  const suffix = resolved === "dark" ? "dark" : "light";
  if (svg) svg.href = `/assets/brand-${suffix}.svg?v=2`;
  if (png) png.href = `/assets/brand-${suffix}-32.png?v=2`;
  const touch = document.getElementById("favTouch") as HTMLLinkElement | null;
  if (touch) touch.href = `/assets/brand-${suffix}-180.png?v=2`;
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

  const value = useMemo(() => ({ mode, setMode: setModeState }), [mode]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// oxlint-disable-next-line react/only-export-components -- context 文件同时导出 Provider 与 Hook
export function useTheme(): ThemeCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
