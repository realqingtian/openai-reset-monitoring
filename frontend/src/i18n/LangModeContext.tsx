/* 语言模式（中文 / English / 自动）上下文：驱动 i18next.changeLanguage。
   auto 模式清掉 detector 缓存并回退浏览器探测；显式选择则交给 detector 自动缓存（crm-lang）。 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { Lang } from "../utils/format";

export type LangMode = Lang | "auto";

const MODE_KEY = "crm-langmode";

function initialMode(): LangMode {
  try {
    const s = localStorage.getItem(MODE_KEY);
    if (s === "zh" || s === "en" || s === "auto") return s;
  } catch {
    /* ignore */
  }
  return "auto";
}

function detectFromNavigator(): Lang {
  const langs = [navigator.language, ...(navigator.languages || [])].filter(Boolean).map((l) => l.toLowerCase());
  return langs.some((l) => l.startsWith("zh")) ? "zh" : "en";
}

interface LangModeCtx {
  langMode: LangMode;
  setLangMode: (m: LangMode) => void;
}

const Ctx = createContext<LangModeCtx | null>(null);

export function LangModeProvider({ children }: { children: ReactNode }) {
  const { i18n } = useTranslation();
  const [langMode, setMode] = useState<LangMode>(initialMode);

  // 非 auto 模式在刷新后也要落到具体语言（detector 只在 auto 缺省时探测）
  useEffect(() => {
    if (langMode !== "auto" && i18n.language !== langMode) void i18n.changeLanguage(langMode);
    // 仅初始化时对齐一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setLangMode = useCallback(
    (m: LangMode) => {
      setMode(m);
      try {
        localStorage.setItem(MODE_KEY, m);
      } catch {
        /* ignore */
      }
      if (m === "auto") {
        try {
          localStorage.removeItem("crm-lang"); // 清掉 detector 缓存，回退浏览器探测
        } catch {
          /* ignore */
        }
        void i18n.changeLanguage(detectFromNavigator());
      } else {
        void i18n.changeLanguage(m);
      }
    },
    [i18n],
  );

  const value = useMemo(() => ({ langMode, setLangMode }), [langMode, setLangMode]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// oxlint-disable-next-line react/only-export-components -- context 文件同时导出 Provider 与 Hook
export function useLangMode(): LangModeCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useLangMode must be used within LangModeProvider");
  return ctx;
}
