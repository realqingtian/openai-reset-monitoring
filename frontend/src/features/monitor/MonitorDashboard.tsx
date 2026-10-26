/* 首屏统一呈现公共公告、数据新鲜度与提醒入口，管理员记录按需加载。 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { j } from "../../api/client";
import type { MonitorAdmin, MonitorHealth, Stats, Status } from "../../api/types";
import { useAuth } from "../../context/AuthContext";
import { useLang } from "../../i18n/useLang";
import { useTime } from "../../context/TimeContext";
import { ago } from "../../utils/format";
import { ForecastSummary } from "../forecast/ForecastSummary";

export function MonitorDashboard({ status, stats, health, retry }: {
  status: Status | null; stats: Stats | null; health: MonitorHealth | null; retry: () => void;
}) {
  const { t } = useTranslation();
  const time = useTime();
  const fmtLocal = time.stamp;
  const lang = useLang();
  const auth = useAuth();
  const [reminders, setReminders] = useState(false);
  const [admin, setAdmin] = useState<MonitorAdmin | null>(null);
  const [adminOpen, setAdminOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);
  const forecast = stats?.forecast;
  const mayManage = !auth.required || auth.loggedIn;
  const configured = (health?.channels || status?.notifiers || []).filter(c => c.enabled && c.configured);
  const healthState = health && ["healthy", "degraded"].includes(health.state) && health.last_success_at && now - Date.parse(health.last_success_at) > health.stale_after_seconds * 1000 ? "stale" : health?.state || "waiting";

  async function loadAdmin() {
    setBusy(true); setError(false);
    try {
      const data = await auth.guard(() => j<MonitorAdmin>("/api/admin/monitor?limit=200"));
      setAdmin(data); setAdminOpen(true);
    } catch { setError(true); }
    finally { setBusy(false); }
  }

  return <>
    <section className="monitor-summary" aria-label={t("monitorSummaryTitle")}>
      <div className="monitor-summary-heading">
        <h2>{t("monitorSummaryTitle")}</h2>
        <span className={"monitor-health " + healthState} role="status">{t(`monitorState_${healthState}`)}</span>
      </div>
      <div className="monitor-summary-grid">
        <div className="monitor-completed">
          <span>{t("monitorLastCompletion")}</span>
          <strong>{!stats ? t("monitorLoading") : forecast?.last_reset_at ? ago(forecast.last_reset_at, lang) : t("monitorNoCompletion")}</strong>
          {forecast?.last_reset_at && <time dateTime={forecast.last_reset_at}>{fmtLocal(forecast.last_reset_at)} · {time.label}</time>}
          <p>{t("monitorAnnouncementBoundary")}</p>
        </div>
        <div className="monitor-forecast">{stats ? <ForecastSummary forecast={forecast} /> : <p role="status">{t("monitorLoading")}</p>}</div>
      </div>
      <div className="monitor-freshness">
        <span>{t("monitorLastSuccess", { time: health?.last_success_at ? ago(health.last_success_at, lang) : t("monitorNever") })}</span>
        <span>{t("monitorLastAttempt", { time: health?.last_attempt_at ? ago(health.last_attempt_at, lang) : t("monitorNever") })}</span>
        {health && <span>{t("monitorSourceCount", { healthy: health.healthy_sources, total: health.enabled_sources })}</span>}
        {forecast?.analyzed_at && <span>{t("monitorAnalysisTime", { time: ago(forecast.analyzed_at, lang) })}</span>}
      </div>
      {health && ["offline", "stale", "unconfigured", "degraded"].includes(healthState) && <p className="monitor-warning" role="status">{t("monitorStaleBoundary")}</p>}
      <div className="monitor-actions">
        <button type="button" className="btn btn-ghost" onClick={() => document.getElementById("reset-events")?.scrollIntoView({ block: "start" })}>{t("eventTimelineTitle")}</button>
        <button type="button" className="btn btn-ghost" aria-expanded={reminders} aria-controls="monitor-reminders" onClick={() => setReminders(v => !v)}>{t("monitorReminders", { n: configured.length })}</button>
        <button type="button" className="btn btn-ghost" disabled={busy} aria-expanded={adminOpen && mayManage} aria-controls="monitor-admin" onClick={() => { if (adminOpen && mayManage) setAdminOpen(false); else void loadAdmin(); }}>{t(busy ? "monitorLoading" : "monitorDetails")}</button>
        {!health && <button type="button" className="btn btn-ghost" onClick={retry}>{t("postsRetry")}</button>}
      </div>
      {error && <p className="section-load-error" role="alert">{t("monitorDetailsFailed")}</p>}
      {reminders && <div id="monitor-reminders" className="monitor-reminders">
        <button className="btn btn-ghost" type="button" onClick={() => document.getElementById("visitor-subscriptions")?.scrollIntoView({block:"start"})}>{t("publicTitle")}</button>
        <h3>{t("monitorReminderTitle")}</h3><p>{t("monitorReminderHint")}</p>
        <ul className="monitor-channel-list">{(health?.channels || status?.notifiers || []).map(channel => <li key={channel.name}>
          <span>{t("channel_" + channel.name, { defaultValue: channel.name })}</span><span>{t(channel.enabled && channel.configured ? "ntReady" : "stUnconfigured")}</span>
        </li>)}</ul>
        {!configured.length && <p>{t("notifHint")}</p>}
        {status?.demo && <p>{t("demoNotifyHint")}</p>}
      </div>}
    </section>
    {adminOpen && mayManage && admin && <section id="monitor-admin" className="monitor-admin" aria-label={t("monitorDetails")}>
      <div className="monitor-summary-heading"><h2>{t("monitorDetails")}</h2><button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void loadAdmin()}>{t("monitorRefreshDetails")}</button></div>
      <div className="monitor-admin-grid">
        <div><h3>{t("dataSources")}</h3>{admin.sources.map(source => <div className="monitor-source-row" key={source.name}>
          <strong>{source.name}</strong><span>{t(!source.enabled || !source.configured ? "stUnconfigured" : !source.known ? "stWait" : source.healthy ? "monitorState_healthy" : "monitorState_offline")}</span>
          <span>{t("monitorLastSuccess", { time: source.last_ok ? ago(source.last_ok, lang) : t("monitorNever") })}</span>
          {source.last_error && <details><summary>{t("errorDetails")}</summary><p>{source.last_error}</p></details>}
        </div>)}</div>
        <div><h3>{t("monitorDeliveryStatus")}</h3>{admin.channels.map(channel => <div className="monitor-source-row" key={channel.name}>
          <strong>{t("channel_" + channel.name, { defaultValue: channel.name })}</strong><span>{t(channel.last_result == null ? "monitorNoDelivery" : channel.last_result ? "monitorDeliveryAccepted" : "monitorDeliveryFailed")}</span>
          <span>{t("monitorPendingRetries", { n: channel.pending_retries })}</span>
          {channel.last_attempt_at && <time dateTime={channel.last_attempt_at}>{fmtLocal(channel.last_attempt_at)}</time>}
        </div>)}</div>
      </div>
      <details className="monitor-log"><summary>{t("monitorDeliveryLog", { n: admin.deliveries.length })}</summary>
        <p>{t("monitorDeliveryBoundary")}</p><div className="monitor-table-scroll"><table><thead><tr><th>{t("monitorTime")}</th><th>{t("monitorChannel")}</th><th>{t("monitorResult")}</th><th>{t("monitorRecord")}</th></tr></thead><tbody>
          {admin.deliveries.map(row => <tr key={row.id}><td>{row.ts ? fmtLocal(row.ts) : "—"}</td><td>{t("channel_" + row.channel, { defaultValue: row.channel })}</td><td>{t(row.ok ? "monitorDeliveryAccepted" : "monitorDeliveryFailed")}{row.error && <p>{row.error}</p>}</td><td>{row.tweet_id}</td></tr>)}
        </tbody></table></div>{!admin.deliveries.length && <p>{t("monitorNoDelivery")}</p>}
      </details>
      <details className="monitor-log"><summary>{t("monitorPollLog", { n: admin.polls.length })}</summary><p>{t("pollLogTip")}</p>
        <div className="monitor-table-scroll"><table><thead><tr><th>{t("monitorTime")}</th><th>{t("monitorSource")}</th><th>{t("monitorResult")}</th><th>{t("monitorNewPosts")}</th></tr></thead><tbody>
          {admin.polls.map(row => <tr key={row.id}><td>{row.ts ? fmtLocal(row.ts) : "—"}</td><td>{row.account} · {row.source}</td><td>{t(row.ok ? "monitorPollSuccess" : "monitorDeliveryFailed")}{row.error && <p>{row.error}</p>}</td><td>{row.new_tweets}</td></tr>)}
        </tbody></table></div>
      </details>
    </section>}
  </>;
}
