/* 公告完成状态来自语义分析，预测按窗口展示，不从发帖时间推断生效。 */
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { j } from "../../api/client";
import type { CalendarData, CalendarEvent } from "../../api/types";
import { useLang } from "../../i18n/useLang";
import { SVG_CHEV_LEFT, SVG_CHEV_RIGHT, SVG_CLOCK, SVG_CLOSE } from "../../components/icons";
import { useTime } from "../../context/TimeContext";
import { ForecastSummary } from "../forecast/ForecastSummary";
import { PostContent } from "../feed/Feed";
import { ago } from "../../utils/format";

function eventState(ev: CalendarEvent) {
  return ev.phase === "completed" ? "done" : ev.phase === "scheduled" ? "pending" : "unknown";
}

interface CalendarProps {
  tick: number;
  onLoadingChange: (loading: boolean) => void;
  posts: ReactNode;
  heatmap: ReactNode;
}

export function CalendarSection(props: CalendarProps) {
  const time = useTime();
  return <CalendarBody key={time.mode} {...props} />;
}

function CalendarBody({ tick, onLoadingChange, posts, heatmap }: CalendarProps) {
  const { t } = useTranslation();
  const time = useTime();
  const dayKey = time.dayKey;
  const initial = dayKey(new Date()).split("-").map(Number);
  const lang = useLang();
  const locale = lang === "zh" ? "zh-CN" : "en-US";
  const [ym, setYm] = useState(() => ({ y: initial[0], m: initial[1] }));
  const [data, setData] = useState<CalendarData | null>(null);
  const [err, setErr] = useState(false);
  const [loading, setLoading] = useState(true);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const detailsId = useId();
  const closeDetails = useCallback(() => setDetailsOpen(false), []);
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
  }, [data, dayKey]);
  const cells = useMemo(() => {
    const offset = (new Date(Date.UTC(ym.y, ym.m - 1, 1)).getUTCDay() + 6) % 7;
    const count = Math.ceil((offset + new Date(Date.UTC(ym.y, ym.m, 0)).getUTCDate()) / 7) * 7;
    return Array.from({ length: count }, (_, i) => {
      const date = new Date(Date.UTC(ym.y, ym.m - 1, i + 1 - offset));
      return { key: date.toISOString().slice(0, 10), num: date.getUTCDate(), off: date.getUTCMonth() + 1 !== ym.m };
    });
  }, [ym]);
  const forecast = data?.forecast;
  const lastReset = forecast?.last_reset_at;
  const hasLastReset = !!lastReset && Number.isFinite(Date.parse(lastReset)) && Date.parse(lastReset) <= now;
  const activeWindow = !!forecast && ["announced", "estimated"].includes(forecast.status) && !!forecast.window_start && !!forecast.window_end && Date.parse(forecast.window_end) >= now;
  const predStartDay = activeWindow ? dayKey(new Date(forecast.window_start!)) : null;
  const predEndDay = activeWindow ? dayKey(new Date(forecast.window_end!)) : null;
  const inWindow = (day: string) => !!predStartDay && !!predEndDay && day >= predStartDay && day <= predEndDay;
  const today = dayKey(new Date(now));
  const selectedEvents = byDay.get(sel) || [];
  const month = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(ym.y, ym.m - 1, 1)));
  function goMonth(delta: number) {
    const next = new Date(Date.UTC(ym.y, ym.m - 1 + delta, 1));
    setData(null); setErr(false); setLoading(true);
    setYm({ y: next.getUTCFullYear(), m: next.getUTCMonth() + 1 });
    setSel(next.toISOString().slice(0, 10));
    setDetailsOpen(false);
  }
  function goToday() {
    const today = dayKey(new Date());
    const [y, m] = today.split("-").map(Number);
    if (ym.y !== y || ym.m !== m) { setData(null); setErr(false); setLoading(true); setYm({ y, m }); }
    setSel(today);
    setDetailsOpen(false);
  }
  return <div className="reset-workspace">
      <section className="forecast-strip glass-surface" aria-label={t("forecastPanelTitle")} aria-busy={loading}>
        <span className="forecast-symbol" aria-hidden="true"><img src="/assets/calendar-days.svg" width={30} height={30} alt="" /></span>
        <div className="forecast-strip-content">
          <h2>{t("forecastPanelTitle")}</h2>
          {data ? <ForecastSummary forecast={forecast} compact /> : <p className="forecast-loading" role="status">{t(loading ? "monitorLoading" : "calLoadFail")}</p>}
        </div>
        <aside className="latest-completion" aria-label={t("forecastLastCompleted")}>
          <span className="ui-icon" aria-hidden="true" dangerouslySetInnerHTML={{ __html: SVG_CLOCK }} />
          <div><span>{t("forecastLastCompleted")}</span>
            {hasLastReset ? <>
              <strong><time dateTime={lastReset}>{time.stamp(lastReset).slice(0, 16)}</time></strong>
              <span className="latest-completion-meta">{ago(lastReset, lang)} · {time.label}</span>
              <span className="latest-completion-note">{t("forecastLastCompletedHint")}</span>
            </> : <span className="latest-completion-empty">{t(!data && loading ? "monitorLoading" : !data ? "calLoadFail" : "noCompletedAnnouncement")}</span>}
          </div>
        </aside>
      </section>
      <section className="calendar-month glass-surface" aria-label={t("calTitle")} aria-busy={loading}>
        <div className="cal-nav">
          <div className="cal-heading"><h2>{t("calTitle")}</h2><h3>{month}</h3></div>
          <div className="cal-month-actions">
            <button className="cal-nav-btn" type="button" aria-label={t("calPrev")} onClick={() => goMonth(-1)}><span aria-hidden="true" dangerouslySetInnerHTML={{ __html: SVG_CHEV_LEFT }} /></button>
            <button className="cal-nav-btn cal-today-btn" type="button" onClick={goToday}>{t("calToday")}</button>
            <button className="cal-nav-btn" type="button" aria-label={t("calNext")} onClick={() => goMonth(1)}><span aria-hidden="true" dangerouslySetInnerHTML={{ __html: SVG_CHEV_RIGHT }} /></button>
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
              aria-label={`${t("calSelectDay", { day: cell.key })} · ${t("calEventCount", { n: list.length })}${inWindow(cell.key) ? ` · ${t("forecastWindowShort")}` : ""}`} aria-pressed={cell.key === sel} aria-haspopup="dialog" aria-expanded={detailsOpen && cell.key === sel} aria-controls={detailsOpen && cell.key === sel ? detailsId : undefined}
              onClick={() => {
                if (cell.off) {
                  const date = new Date(`${cell.key}T00:00:00Z`);
                  setData(null); setErr(false); setLoading(true); setYm({ y: date.getUTCFullYear(), m: date.getUTCMonth() + 1 });
                }
                setSel(cell.key);
                setDetailsOpen(true);
              }}
              onKeyDown={(event) => {
                const shift = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : event.key === "ArrowDown" ? 7 : event.key === "ArrowUp" ? -7 : null;
                if (shift != null) {
                  const next = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(".cal-cell")[index + shift];
                  if (next) { event.preventDefault(); next.focus(); }
                }
              }}>
              <span className="cal-num">{cell.num}</span>
              {list.length > 0 && <span className="cal-announcement-dot" aria-hidden="true" />}
              {inWindow(cell.key) && <span className="cal-compact-window" aria-hidden="true" />}
            </button>;
          })}
        </div>

      </section>
      {heatmap}
      {posts}
      {detailsOpen && <CalendarDayDialog id={detailsId} day={sel} events={selectedEvents} today={today} ready={!!data} loading={loading} failed={err} predicted={inWindow(sel)} onClose={closeDetails} onRetry={() => setRetry(n => n + 1)} />}
    </div>;
}

interface DayDialogProps {
  id: string;
  day: string;
  today: string;
  events: CalendarEvent[];
  ready: boolean;
  loading: boolean;
  failed: boolean;
  predicted: boolean;
  onClose: () => void;
  onRetry: () => void;
}

function CalendarDayDialog({ id, day, today, events, ready, loading, failed, predicted, onClose, onRetry }: DayDialogProps) {
  const { t } = useTranslation();
  const time = useTime();
  const lang = useLang();
  const locale = lang === "zh" ? "zh-CN" : "en-US";
  const dialogRef = useRef<HTMLDialogElement>(null);
  const pressedBackdrop = useRef(false);
  const date = new Date(`${day}T00:00:00Z`);
  const titleId = `${id}-title`;
  const metaId = `${id}-meta`;
  const fmtTime = (value: string) => new Intl.DateTimeFormat(locale, { ...time.options, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));

  useEffect(() => {
    const dialog = dialogRef.current;
    // Safari 触屏点按不一定给按钮焦点，以展开日期本身作为返回目标。
    const opener = document.querySelector<HTMLButtonElement>('.cal-cell[aria-expanded="true"]') || document.activeElement as HTMLElement | null;
    const page = document.documentElement;
    const previousOverflow = page.style.overflowY;
    const previousPadding = page.style.paddingRight;
    const scrollbar = window.innerWidth - page.clientWidth;
    // 原生模态层负责焦点圈定；补偿滚动条宽度，避免打开详情时底下的双列布局横移。
    if (scrollbar > 0) page.style.paddingRight = `${parseFloat(getComputedStyle(page).paddingRight) + scrollbar}px`;
    page.style.overflowY = "hidden";
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      dialog?.close();
      page.style.overflowY = previousOverflow;
      page.style.paddingRight = previousPadding;
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);

  function outside(dialog: HTMLDialogElement, x: number, y: number) {
    const rect = dialog.getBoundingClientRect();
    return x < rect.left || x > rect.right || y < rect.top || y > rect.bottom;
  }

  return createPortal(<dialog ref={dialogRef} id={id} className="calendar-day-dialog" aria-labelledby={titleId} aria-describedby={metaId}
    onCancel={event => { event.preventDefault(); onClose(); }}
    onKeyDown={event => {
      if (event.key !== "Tab") return;
      const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], summary, [tabindex="0"]')).filter(item => item.getClientRects().length > 0);
      const first = items[0];
      const last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}
    onPointerDown={event => { pressedBackdrop.current = event.target === event.currentTarget && outside(event.currentTarget, event.clientX, event.clientY); }}
    onClick={event => {
      // 必须从遮罩开始并在遮罩结束，正文选择或拖动滚动条不会误关浮层。
      if (pressedBackdrop.current && event.target === event.currentTarget && outside(event.currentTarget, event.clientX, event.clientY)) onClose();
      pressedBackdrop.current = false;
    }}>
    <header className="calendar-day-header">
      <div><span className="calendar-day-eyebrow">{t("calDateDetails")}</span><h2 id={titleId}>{new Intl.DateTimeFormat(locale, { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }).format(date)}</h2>
        <p id={metaId}>{new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: "UTC" }).format(date)}{day === today ? ` · ${t("calToday")}` : ""}{ready ? ` · ${t("calEventCount", { n: events.length })}` : ""}</p>
        <span className="calendar-day-zone">{time.label}</span>
      </div>
      <button className="calendar-day-close" type="button" aria-label={t("calCloseDetails")} autoFocus onClick={onClose}><span aria-hidden="true" dangerouslySetInnerHTML={{ __html: SVG_CLOSE }} /></button>
    </header>
    <div className="calendar-day-body" aria-busy={loading}>
      {failed && <div className="section-load-error calendar-day-error" role="alert"><span>{t("calLoadFail")}</span><button className="btn btn-ghost" type="button" disabled={loading} onClick={onRetry}>{t("postsRetry")}</button></div>}
      {!ready && loading && <div className="calendar-day-loading" role="status">{t("monitorLoading")}</div>}
      {ready && !events.length && <div className="calendar-day-empty"><p>{t(predicted ? "calPredOnly" : "calNoAnnouncements")}</p><span>{t("calNoAnnouncementsHint")}</span></div>}
      {events.map(ev => <article className="calendar-day-event" key={ev.event_id || ev.id}>
        <div className="ce-head"><time dateTime={ev.created_at}>{fmtTime(ev.created_at)}</time><strong>{t(ev.kind === "card" ? "evCard" : ev.kind === "other" ? "evOther" : "evQuota")}</strong><span className={`ce-state ${eventState(ev)}`} title={t("eventPhaseHint_" + (eventState(ev) === "done" ? "completed" : eventState(ev) === "pending" ? "scheduled" : "unknown"))}>{t(eventState(ev) === "done" ? "stDone" : eventState(ev) === "pending" ? "stPending" : "stUnknown")}</span></div>
        <PostContent tw={{ ...ev, matched_terms: [] }} />
        {(ev.evidence?.length || 0) > 1 && <details className="event-evidence"><summary>{t("eventEvidenceCount", { n: ev.evidence!.length })}</summary>
          {ev.evidence!.map(source => <div className="event-source" key={source.id}><time dateTime={source.created_at}>{fmtTime(source.created_at)}</time><PostContent tw={source} /></div>)}
        </details>}
      </article>)}
    </div>
  </dialog>, document.body);
}
