/* 首屏优先回答下次重置时间；来源措辞不直接换算为浏览者的今天。 */
import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ResetForecast } from "../../api/types";
import { useLang } from "../../i18n/useLang";
import { useTime } from "../../context/TimeContext";
import { SVG_CHEV } from "../../components/icons";
import { safeUrl } from "../../utils/format";

export function ForecastSummary({ forecast, compact = false }: { forecast?: ResetForecast | null; compact?: boolean }) {
  const { t } = useTranslation();
  const lang = useLang();
  const time = useTime();
  const [now, setNow] = useState(Date.now);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const evidenceId = useId();
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);
  const start = Date.parse(forecast?.window_start || "");
  const end = Date.parse(forecast?.window_end || "");
  const elapsed = Number.isFinite(end) && now > end;
  const active = !!forecast && ["announced", "estimated"].includes(forecast.status) && !elapsed && Number.isFinite(start) && Number.isFinite(end);
  const preview = forecast?.pending_preview;
  const pending = !!preview && !elapsed;
  const oldPreview = !!preview && now - Date.parse(preview.published_at) >= 24 * 60 * 60 * 1000;
  const reason = elapsed ? "elapsed" : forecast?.reason_code === "cadence" && forecast.method === "history" ? "cadence_history" : forecast?.reason_code || "insufficient";
  const locale = lang === "zh" ? "zh-CN" : "en-US";
  const fmt = (value: string) => new Intl.DateTimeFormat(locale, { ...time.options, month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
  const clock = (value: string) => new Intl.DateTimeFormat(locale, { ...time.options, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
  const day = (value: string) => new Intl.DateTimeFormat(locale, { ...time.options, month: "short", day: "numeric" }).format(new Date(value));
  const heading = elapsed ? "forecastAwaitUpdate" : "forecastTimeUnknown";
  const origin = active ? forecast.status === "announced" ? "forecastSourcePreview" : "forecastSourceEstimate" : pending ? "forecastSourcePreview" : "forecastSourceTracking";
  const explanation = pending && !active ? oldPreview ? "forecastEarlierPreviewHint" : preview.timing === "same_day" ? "forecastSameDayHint" : "forecastUntimedHint" : `forecastReason_${reason}`;
  const sample = forecast && <p className="forecast-sample">{t("forecastSamples", { posts: forecast.sample_posts, events: forecast.sample_events })}{forecast.sample_since && forecast.sample_until && <span>{t("forecastCoverage", { start: day(forecast.sample_since), end: day(forecast.sample_until) })}</span>}</p>;
  return <div className={"forecast-summary" + (compact ? " forecast-summary--compact" : "")}>
    <div className="forecast-summary-heading"><span className="forecast-origin">{t(origin)}</span>{active && <span>{t(forecast.status === "announced" ? "forecastAnnouncedWindow" : "forecastEstimatedWindow")}</span>}</div>
    {active ? <strong className="forecast-outlook forecast-window" title={`UTC ${forecast.window_start} — ${forecast.window_end}`}>
      <span>{t("forecastExpectedReset")}</span>
      <time dateTime={forecast.window_start!}>{fmt(forecast.window_start!)}</time><span aria-hidden="true">–</span><time dateTime={forecast.window_end!}>{time.dayKey(new Date(start)) === time.dayKey(new Date(end)) ? clock(forecast.window_end!) : fmt(forecast.window_end!)}</time>
    </strong> : <strong className="forecast-outlook">{t(heading)}</strong>}
    <p className="forecast-explanation">{t(explanation, { account: preview?.account })}</p>
    {preview && <div className="forecast-next-source">
      <p className="forecast-preview-text">{preview.text}</p>
      <div className="forecast-source-meta"><span>{t("forecastSourceAccount", { account: preview.account })}</span><time dateTime={preview.published_at}>{fmt(preview.published_at)}</time>{safeUrl(preview.url) !== "#" && <a href={safeUrl(preview.url)} target="_blank" rel="noopener noreferrer">{t("forecastViewPreview")}</a>}</div>
    </div>}
    <div className="forecast-summary-footer">
      <p className="forecast-followup">{active ? t(now < start ? "forecastWindowNotStarted" : "forecastWindowTracking") : t(pending ? "forecastAutoFollowup" : "forecastWatchFollowup")}</p>
      {forecast && (!!forecast.evidence.length || compact) && <button className="forecast-evidence-toggle" type="button" aria-expanded={evidenceOpen} aria-controls={evidenceId} onClick={() => setEvidenceOpen(open => !open)}><span aria-hidden="true" dangerouslySetInnerHTML={{ __html: SVG_CHEV }} />{t(evidenceOpen ? "forecastEvidenceHide" : "forecastEvidence")}</button>}
    </div>
    {active && <p className="forecast-confidence">{t(forecast.confidence === "medium" ? "forecastConfidenceMedium" : "forecastConfidenceLow")} · {time.label} · {t("forecastNotPersonal")}</p>}
    {!compact && sample}
    {forecast && <div className="forecast-evidence forecast-evidence-panel" id={evidenceId} hidden={!evidenceOpen} role="region" aria-label={t("forecastEvidence")}>{compact && sample}{forecast.evidence.map((entry) => <article key={entry.id}><time>{fmt(entry.published_at)}</time><p>{entry.text}</p>{entry.analysis && <p className="forecast-analysis">{t("forecastAnalysisLabel")}{entry.analysis}</p>}{safeUrl(entry.url) !== "#" && <a href={safeUrl(entry.url)} target="_blank" rel="noopener noreferrer">{t("viewOnX")}</a>}</article>)}</div>}
  </div>;
}
