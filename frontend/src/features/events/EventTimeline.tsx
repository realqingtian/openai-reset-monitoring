/* 独立事件与原帖分层展示；翻页后收到新数据时提示刷新，避免后台重排打断阅读。 */
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { j } from "../../api/client";
import type { EventFilter, EventPage } from "../../api/types";
import { useAuth } from "../../context/AuthContext";
import { useLang } from "../../i18n/useLang";
import { safeUrl } from "../../utils/format";
import { useTime } from "../../context/TimeContext";
import { PostContent } from "../feed/Feed";
import { EventFilters } from "./EventFilters";

const EventReviewPanel = lazy(() => import("./EventReviewPanel").then(module => ({ default: module.EventReviewPanel })));

export function EventTimeline({ tick, accounts }: { tick: number; accounts: string[] }) {
  const { t } = useTranslation();
  const time = useTime();
  const lang = useLang();
  const auth = useAuth();
  const [reviewing, setReviewing] = useState(false);
  const fmtLocal = time.stamp;
  const [filter, setFilter] = useState<EventFilter>({ kind: "", phase: "", account: "" });
  const [data, setData] = useState<EventPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [stale, setStale] = useState(false);
  const [retry, setRetry] = useState(0);
  const request = useRef<AbortController | null>(null);
  const paged = useRef(false);
  const previousKey = useRef("");
  const key = JSON.stringify(filter);
  const query = new URLSearchParams({ limit: "10" });
  if (filter.kind) query.set("kind", filter.kind);
  if (filter.phase) query.set("phase", filter.phase);
  if (filter.account) query.set("account", filter.account);
  const params = query.toString();

  useEffect(() => {
    if (previousKey.current === key && paged.current) {
      queueMicrotask(() => setStale(true));
      return;
    }
    const changed = previousKey.current !== key;
    previousKey.current = key;
    const controller = new AbortController();
    request.current?.abort(); request.current = controller;
    queueMicrotask(() => {
      if (controller.signal.aborted) return;
      setLoading(true); setError(false); setStale(false);
      if (changed) setData(null);
      void j<EventPage>(`/api/events?${params}`, { signal: controller.signal }).then(page => {
        if (!controller.signal.aborted) setData(page);
      }).catch(() => { if (!controller.signal.aborted) setError(true); })
        .finally(() => { if (!controller.signal.aborted) { setLoading(false); request.current = null; } });
    });
    return () => controller.abort();
  }, [key, params, tick, retry]);

  useEffect(() => () => request.current?.abort(), []);

  async function more() {
    if (!data?.next_cursor || request.current) return;
    const controller = new AbortController(); request.current = controller;
    setLoading(true); setError(false);
    try {
      const page = await j<EventPage>(`/api/events?${params}&before=${encodeURIComponent(data.next_cursor)}`, { signal: controller.signal });
      if (controller.signal.aborted) return;
      paged.current = true;
      setData(old => old ? { ...page, items: Array.from(new Map([...old.items, ...page.items].map(event => [event.id, event])).values()) } : page);
    } catch { if (!controller.signal.aborted) setError(true); }
    finally { if (request.current === controller) { request.current = null; setLoading(false); } }
  }

  function refresh() { paged.current = false; setRetry(value => value + 1); }
  function change(next: EventFilter) { paged.current = false; setFilter(next); }

  return <section id="reset-events" className="event-timeline" aria-label={t("eventTimelineTitle")} aria-busy={loading}>
    <div className="monitor-summary-heading"><h2>{t("eventTimelineTitle")}</h2><button className="btn btn-ghost" type="button" disabled={loading} onClick={refresh}>{t("eventRefresh")}</button></div>
    <p className="event-boundary">{t("eventTimelineBoundary")}</p>
    <details className="event-subscriptions"><summary>{t("eventSubscriptions")}</summary><p>{t("eventExportBoundary")}</p><div className="monitor-actions">{["calendar.ics", "feed.atom", "feed.rss"].map(file => <a className="btn btn-ghost" key={file} href={safeUrl(`${window.location.origin}/${file}?lang=${lang}${filter.kind ? `&kind=${filter.kind}` : ""}`)} target="_blank" rel="noopener noreferrer">{t(file === "calendar.ics" ? "eventDownloadCalendar" : file === "feed.atom" ? "eventAtom" : "eventRSS")}</a>)}</div></details>
    <EventFilters value={filter} onChange={change} accounts={accounts} label={t("eventFilters")} />
    {data && <div className="event-counts"><span>{t("eventCompleted30", { n: data.completed_30d })}</span><span>{t("eventCards30", { n: data.cards_30d })}</span><span>{t("eventFilteredTotal", { n: data.total })}</span></div>}
    {stale && <p className="event-update-notice" role="status">{t("eventSnapshotStale")} <button type="button" onClick={refresh}>{t("eventRefresh")}</button></p>}
    {error && <p className="section-load-error" role="alert">{t("postsLoadFail")} <button type="button" onClick={() => { if (data?.next_cursor && paged.current) void more(); else refresh(); }}>{t("postsRetry")}</button></p>}
    {!data && loading && <p role="status">{t("postsLoading")}</p>}
    {(!auth.required || auth.loggedIn) && <button className="btn btn-ghost" type="button" aria-expanded={reviewing} onClick={() => setReviewing(value => !value)}>{t("reviewTitle")}</button>}
    {reviewing && (!auth.required || auth.loggedIn) && data && <Suspense fallback={<p role="status">{t("monitorLoading")}</p>}><EventReviewPanel key={key} events={data.items} onSaved={refresh} /></Suspense>}
    {data?.items.map(event => <article className="reset-event" key={event.id}>
      <div className="event-heading"><strong>{t("eventKind_" + event.kind)}</strong><span className={"event-phase " + event.phase}>{t("eventPhase_" + event.phase)}</span><span className="event-account">@{event.account}</span></div>
      <p className="event-times"><time dateTime={event.announced_at}>{t("eventFirstAnnouncement", { time: fmtLocal(event.announced_at) })}</time>{event.completed_at && <time dateTime={event.completed_at}>{t("eventCompletionAnnouncement", { time: fmtLocal(event.completed_at) })}</time>}</p>
      {event.evidence.length > 0 && <PostContent tw={event.evidence[event.evidence.length - 1]} />}
      <details className="event-evidence"><summary>{t("eventEvidenceCount", { n: event.evidence.length })}</summary>
        {event.evidence.map(source => <div className="event-source" key={source.id}><time dateTime={source.created_at}>{fmtLocal(source.created_at)} · {t("eventPhase_" + (source.phase || "unknown"))}</time><PostContent tw={source} /></div>)}
      </details>
    </article>)}
    {data && !data.items.length && <p className="empty">{t("eventEmpty")}</p>}
    {data?.next_cursor && <button className="feed-more" type="button" disabled={loading} onClick={() => void more()}>{t(loading ? "postsLoading" : "eventLoadMore")}</button>}
  </section>;
}
