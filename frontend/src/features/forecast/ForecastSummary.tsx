/* 公告窗口优先；证据不足或窗口已过时不回退到前端自算倒计时。 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ResetForecast } from "../../api/types";
import { useLang } from "../../i18n/useLang";
import { safeUrl } from "../../utils/format";

export function ForecastSummary({ forecast }: { forecast?: ResetForecast | null }) {
  const { t } = useTranslation();
  const lang = useLang();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);
  const start = Date.parse(forecast?.window_start || "");
  const end = Date.parse(forecast?.window_end || "");
  const elapsed = Number.isFinite(end) && now > end;
  const active = !!forecast && ["announced", "estimated"].includes(forecast.status) && !elapsed && Number.isFinite(start) && Number.isFinite(end);
  const reason = elapsed ? "elapsed" : forecast?.reason_code === "cadence" && forecast.method === "history" ? "cadence_history" : forecast?.reason_code || "insufficient";
  const fmt = (value: string) => new Intl.DateTimeFormat(lang === "zh" ? "zh-CN" : "en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
  const day = (value: string) => new Intl.DateTimeFormat(lang === "zh" ? "zh-CN" : "en-US", { month: "short", day: "numeric" }).format(new Date(value));
  return <div className="forecast-summary">
    <div className="forecast-summary-heading"><strong>{t(active ? "forecastWindow" : "forecastUnavailable")}</strong>{forecast && <span>{t(forecast.method === "ai_announcement" ? "forecastFromAnnouncement" : forecast.method === "ai_history" ? "forecastFromAI" : "forecastFromHistory")}</span>}</div>
    {active && <p className="forecast-window" title={`UTC ${forecast.window_start} — ${forecast.window_end}`}>{fmt(forecast.window_start!)}<span> — </span>{fmt(forecast.window_end!)}</p>}
    <p className="forecast-explanation">{t(`forecastReason_${reason}`)}</p>
    {active && <p className="forecast-confidence">{t(forecast.confidence === "medium" ? "forecastConfidenceMedium" : "forecastConfidenceLow")} · {t("forecastNotPersonal")}</p>}
    {forecast && <p className="forecast-sample">{t("forecastSamples", { posts: forecast.sample_posts, events: forecast.sample_events })}{forecast.sample_since && forecast.sample_until && <span>{t("forecastCoverage", { start: day(forecast.sample_since), end: day(forecast.sample_until) })}</span>}</p>}
    {!!forecast?.evidence.length && <details className="forecast-evidence"><summary>{t("forecastEvidence")}</summary>{forecast.evidence.map((entry) => <article key={entry.id}><time>{fmt(entry.published_at)}</time><p>{entry.text}</p>{entry.analysis && <p className="forecast-analysis">{t("forecastAnalysisLabel")}{entry.analysis}</p>}{safeUrl(entry.url) && <a href={safeUrl(entry.url)} target="_blank" rel="noopener noreferrer">{t("viewOnX")}</a>}</article>)}</details>}
  </div>;
}
