/* 显示时区只影响阅读和归日；服务端时间与导出时间始终保留真实 UTC。 */
import { NativeSelect } from "../components/NativeSelect";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useLang } from "../i18n/useLang";

type TimeMode = "local" | "utc";
interface TimeContextValue {
  mode: TimeMode; setMode: (mode: TimeMode) => void; zone: string; label: string;
  stamp: (value: string | null | undefined) => string;
  dayKey: (date: Date) => string;
  options: Intl.DateTimeFormatOptions;
}
const Context = createContext<TimeContextValue | null>(null);
export function TimeProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const lang = useLang();
  const [mode, setMode] = useState<TimeMode>(() => { try { return localStorage.getItem("crm-timezone") === "utc" ? "utc" : "local"; } catch { return "local"; } });
  useEffect(() => { try { localStorage.setItem("crm-timezone", mode); } catch { /* 存储受限不影响切换。 */ } }, [mode]);
  const value = useMemo(() => {
    const zone = mode === "utc" ? "UTC" : Intl.DateTimeFormat().resolvedOptions().timeZone;
    const locale = lang === "zh" ? "zh-CN" : "en-US";
    const options = { timeZone: zone };
    const dayKey = (date: Date) => {
      const parts = new Intl.DateTimeFormat("en-US", { ...options, numberingSystem: "latn", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
      const value = (type: string) => parts.find(part => part.type === type)?.value || "";
      return `${value("year")}-${value("month")}-${value("day")}`;
    };
    const stamp = (raw: string | null | undefined) => {
      const date = new Date(raw || "");
      if (!Number.isFinite(date.getTime())) return "—";
      const parts = new Intl.DateTimeFormat("en-GB", { ...options, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(date);
      const part = (type: string) => parts.find(p => p.type === type)?.value || "";
      return `${dayKey(date)} ${part("hour")}:${part("minute")}:${part("second")}`;
    };
    return { mode, setMode, zone, label: mode === "utc" ? "UTC" : `${t("timeLocal")} · ${zone}`, stamp, dayKey, options, locale };
  }, [mode, lang, t]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
// oxlint-disable-next-line react/only-export-components -- 统一时区上下文与 Hook。
export function useTime() { const value = useContext(Context); if (!value) throw new Error("TimeProvider required"); return value; }
export function TimePreference() {
  const { t } = useTranslation(); const time = useTime();
  return <div className="time-preference"><label htmlFor="display-timezone">{t("timeDisplay")}</label><NativeSelect aria-label={t("timeDisplay")} id="display-timezone" value={time.mode} onChange={e => time.setMode(e.target.value as TimeMode)}><option value="local">{t("timeLocal")}</option><option value="utc">UTC</option></NativeSelect><span>{time.label}</span></div>;
}
