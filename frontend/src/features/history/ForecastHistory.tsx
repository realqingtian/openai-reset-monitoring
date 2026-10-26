/* 历史窗口不可被当前计算覆盖；结果只衡量公告发布时间，样本不足时不显示百分比。 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { j } from "../../api/client";
import type { ResetForecast } from "../../api/types";
import { useTime } from "../../context/TimeContext";
interface History { items: { id: string; created_at: string; account: string; model: string; policy_version: string; forecast: ResetForecast; evaluation: { outcome: string; evaluated_at: string; evidence_ids: string[] } | null }[]; evaluated: number; within_window: number; window_match_rate: number | null; minimum_samples: number; }
export function ForecastHistoryPanel({ tick }: { tick: number }) {
  const { t } = useTranslation(), time = useTime();
  const [open, setOpen] = useState(false), [data, setData] = useState<History | null>(null), [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    void j<History>("/api/forecast-history?limit=30", { signal: controller.signal }).then(value => { if (!controller.signal.aborted) { setData(value); setError(false); } }).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [open, tick, retry]);
  return <section className="forecast-history" aria-label={t("historyTitle")}><details open={open} onToggle={event => setOpen(event.currentTarget.open)}><summary>{t("historyTitle")}</summary><p className="event-boundary">{t("historyBoundary")}</p>
    {error && <p role="alert">{t("postsLoadFail")} <button type="button" onClick={() => setRetry(n => n+1)}>{t("postsRetry")}</button></p>}
    {!data && !error && <p role="status">{t("monitorLoading")}</p>}
    {data && <><p>{t("historySample", { n: data.evaluated, matched: data.within_window })} · {data.window_match_rate == null ? t("historyInsufficient", { n: data.minimum_samples }) : t("historyRate", { n: Math.round(data.window_match_rate * 100) })}</p>
      {!data.items.length && <p>{t("historyEmpty")}</p>}
      {data.items.map(row => <article className="history-row" key={row.id}><div className="event-heading"><time dateTime={row.created_at}>{time.stamp(row.created_at)} · {time.label}</time><strong>{t("historyOutcome_" + (row.evaluation?.outcome || "pending"))}</strong></div><p>{row.forecast.window_start && row.forecast.window_end ? `${time.stamp(row.forecast.window_start)} — ${time.stamp(row.forecast.window_end)}` : t("forecastUnavailable")}</p><p className="event-boundary">{t("historyMethod")}: {row.model} · {row.policy_version}</p><details><summary>{t("forecastEvidence")}</summary>{row.forecast.evidence.map(source => <p key={source.id}>{time.stamp(source.published_at)} · {source.text}</p>)}</details></article>)}
    </>}
  </details></section>;
}
