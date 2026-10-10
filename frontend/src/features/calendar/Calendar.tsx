/* 本地时区月历为主视图；公告状态仍沿用六小时展示约定，预测仅供参考。 */
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { j } from "../../api/client";
import type { CalendarData, CalendarEvent } from "../../api/types";
import { useLang } from "../../i18n/useLang";
import AnimatedContent from "../../components/reactbits/AnimatedContent";
import { PostContent } from "../feed/Feed";

const EFFECTIVE_MS = 6 * 3600e3;
const OVERDUE_MS = 24 * 3600e3;
const pad2 = (n: number) => String(n).padStart(2, "0");
function dayKey(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function eventState(ev: CalendarEvent, now: number) {
  return Date.parse(ev.created_at) + EFFECTIVE_MS <= now ? "done" : "pending";
}

export function CalendarSection({ tick, onLoadingChange }: { tick: number; onLoadingChange: (loading: boolean) => void }) {
  const { t } = useTranslation();
  const lang = useLang();
  const locale = lang === "zh" ? "zh-CN" : "en-US";
  const [ym, setYm] = useState(() => ({ y: new Date().getFullYear(), m: new Date().getMonth() + 1 }));
  const [data, setData] = useState<CalendarData | null>(null);
  const [err, setErr] = useState(false);
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [sel, setSel] = useState(() => dayKey(new Date()));
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => {
      if (controller.signal.aborted) return;
      setLoading(true);
      onLoadingChange(true);
      void j<CalendarData>(`/api/calendar?year=${ym.y}&month=${ym.m}`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]) }).then((d) => {
        if (!controller.signal.aborted) { setData(d); setErr(false); }
      }).catch(() => { if (!controller.signal.aborted) setErr(true); })
        .finally(() => { if (!controller.signal.aborted) { setLoading(false); onLoadingChange(false); } });
    });
    return () => controller.abort();
  }, [ym, tick, retry, onLoadingChange]);

  const byDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    data?.events.forEach((ev) => {
      const key = dayKey(new Date(ev.created_at));
      map.set(key, [...(map.get(key) || []), ev]);
    });
    map.forEach((events) => events.sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)));
    return map;
  }, [data]);
  const cells = useMemo(() => {
    const offset = (new Date(ym.y, ym.m - 1, 1).getDay() + 6) % 7;
    const count = Math.ceil((offset + new Date(ym.y, ym.m, 0).getDate()) / 7) * 7;
    return Array.from({ length: count }, (_, i) => {
      const date = new Date(ym.y, ym.m - 1, i + 1 - offset);
      return { key: dayKey(date), num: date.getDate(), off: date.getMonth() + 1 !== ym.m };
    });
  }, [ym]);
  const pred = data?.prediction;
  const predDay = pred ? dayKey(new Date(pred.expected_at)) : null;
  const predState = pred && now - Date.parse(pred.expected_at) > OVERDUE_MS ? "over" : pred && now >= Date.parse(pred.expected_at) ? "due" : "pending";
  const today = dayKey(new Date(now));
  const selected = new Date(`${sel}T00:00:00`);
  const selectedEvents = byDay.get(sel) || [];
  const month = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(new Date(ym.y, ym.m - 1, 1));
  const fmtTime = (time: string) => new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(time));
  const fmtDateTime = (time: string) => new Intl.DateTimeFormat(locale, { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(time));
  function goMonth(delta: number) {
    const next = new Date(ym.y, ym.m - 1 + delta, 1);
    setData(null); setErr(false); setLoading(true);
    setYm({ y: next.getFullYear(), m: next.getMonth() + 1 });
    setSel(dayKey(next));
  }
  function goToday() {
    const date = new Date();
    if (ym.y !== date.getFullYear() || ym.m !== date.getMonth() + 1) {
      setData(null); setErr(false); setLoading(true); setYm({ y: date.getFullYear(), m: date.getMonth() + 1 });
    }
    setSel(dayKey(date));
  }
  return <section className="calendar-section" aria-label={t("calTitle")} aria-busy={loading}>
    <div className="calendar-workspace">
      <div className="calendar-month">
        <div className="cal-nav">
          <div className="cal-heading"><h1>{month}</h1><span>{t("calTitle")}</span></div>
          <div className="cal-month-actions">
            <button className="cal-nav-btn" type="button" aria-label={t("calPrev")} onClick={() => goMonth(-1)}>‹</button>
            <button className="cal-nav-btn cal-today-btn" type="button" onClick={goToday}>{t("calToday")}</button>
            <button className="cal-nav-btn" type="button" aria-label={t("calNext")} onClick={() => goMonth(1)}>›</button>
          </div>
        </div>
        {err && <div className="cal-message section-load-error" role="alert"><span>{t("calLoadFail")}</span><button type="button" disabled={loading} onClick={() => setRetry((n) => n + 1)}>{t("postsRetry")}</button></div>}
        {!data && loading && <span className="sr-only" role="status">{t("monitorLoading")}</span>}
        <div className="cal-grid" role="group" aria-label={month}>
          {[1,2,3,4,5,6,7].map((i) => <span key={i} className="cal-wd">{t(`calWd${i}`)}</span>)}
          {cells.map((cell, index) => {
            const list = byDay.get(cell.key) || [];
            return <button key={cell.key} type="button"
              className={`cal-cell${cell.off ? " off" : ""}${cell.key === today ? " today" : ""}${cell.key === sel ? " sel" : ""}`}
              aria-label={t("calSelectDay", { day: cell.key })} aria-pressed={cell.key === sel}
              onClick={() => {
                if (cell.off) {
                  const date = new Date(`${cell.key}T00:00:00`);
                  setData(null); setErr(false); setLoading(true); setYm({ y: date.getFullYear(), m: date.getMonth() + 1 });
                }
                setSel(cell.key);
              }}
              onKeyDown={(event) => {
                const shift = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : event.key === "ArrowDown" ? 7 : event.key === "ArrowUp" ? -7 : null;
                if (shift != null) {
                  const next = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(".cal-cell")[index + shift];
                  if (next) { event.preventDefault(); next.focus(); }
                }
              }}>
              <span className="cal-num">{cell.num}</span>
              <span className="cal-events">
                {!data && loading && index % 5 === 1 && <span className="skeleton sk-cal-event" aria-hidden />}
                {list.slice(0,2).map((ev) => <span key={ev.id} className={`cal-event ${eventState(ev, now)}`} title={`${fmtTime(ev.created_at)} ${t(ev.kind === "card" ? "evCard" : "evQuota")}`}>
                  <time>{fmtTime(ev.created_at)}</time><span className="cal-event-label">{t(ev.kind === "card" ? "evCard" : "evQuota")}</span>
                </span>)}
                {list.length > 2 && <span className="cal-more">{t("calMoreEvents", { n: list.length - 2 })}</span>}
                {!list.length && cell.key === predDay && pred && <span className={`cal-event predicted ${predState}`} title={t("predictionDisclaimer")}><time>{fmtTime(pred.expected_at)}</time><span className="cal-event-label">{t("evPred")}</span></span>}
              </span>
            </button>;
          })}
        </div>
      </div>
      <aside className="cal-inspector" aria-label={t("calDateDetails")}>
        <div className="inspector-heading">
          <h2>{new Intl.DateTimeFormat(locale, { month: "long", day: "numeric" }).format(selected)}</h2>
          <p className={sel === today ? "is-today" : ""}>{new Intl.DateTimeFormat(locale, { weekday: "long" }).format(selected)}{sel === today ? ` · ${t("calToday")}` : ""}</p>
        </div>
        <div className="inspector-events">
          {!data && loading && <div className="inspector-skeleton" aria-hidden><span className="skeleton sk-byline" /><span className="skeleton sk-line" /><span className="skeleton sk-line" /><span className="skeleton sk-line short" /></div>}
          {data && !selectedEvents.length && <p className="cal-empty">{t(sel === predDay ? "calPredOnly" : "calEmptyDay")}</p>}
          {selectedEvents.map((ev) => <AnimatedContent distance={6} duration={0.3} initialOpacity={0.7} key={ev.id}><article className="inspector-event">
            <div className="ce-head"><time dateTime={ev.created_at} title={t("calEffAt", { time: fmtDateTime(new Date(Date.parse(ev.created_at) + EFFECTIVE_MS).toISOString()) })}>{fmtTime(ev.created_at)}</time><strong>{t(ev.kind === "card" ? "evCard" : "evQuota")}</strong><span className={`ce-state ${eventState(ev, now)}`}>{t(eventState(ev, now) === "done" ? "stDone" : "stPending")}</span></div>
            <PostContent tw={{ ...ev, matched_terms: [] }} />
          </article></AnimatedContent>)}
        </div>
        <div className="inspector-forecast">
          <div className="forecast-label">{t("calForecastLabel")}<span>{t("referenceOnly")}</span></div>
          {!data && loading ? <div className="forecast-skeleton" aria-hidden><span className="skeleton sk-title" /><span className="skeleton sk-line" /></div> : !data ? <p className="forecast-note">—</p> : pred ? <><p className="forecast-date">{fmtDateTime(pred.expected_at)}</p><p className="forecast-note">{t("calPredBasis", { h: pred.avg_interval_hours })}{predState !== "pending" && ` · ${t(predState === "over" ? "stOver" : "stDue")}`}</p></> : <p className="forecast-note">{t("rhythmNoForecast")}</p>}
        </div>
      </aside>
    </div>

  </section>;
}
