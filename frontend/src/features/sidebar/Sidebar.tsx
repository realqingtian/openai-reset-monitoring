/* 右栏卡片：实时统计（React Bits CountUp 数字动画）、重置节奏、数据源、通知渠道、历史命中、检查日志分页。 */

import { memo, useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { j } from "../../api/client";
import type { Poll, Stats, Status, Tweet } from "../../api/types";
import { ago, fmt, hl, localOffsetLabel, safeUrl } from "../../utils/format";
import { useLang } from "../../i18n/useLang";
import type { Lang } from "../../utils/format";
import CountUp from "../../components/reactbits/CountUp";

export function LiveStats({ status }: { status: Status | null }) {
  const { t } = useTranslation();
  const hit = (status?.hit_count_24h ?? 0) > 0;
  return (
    <>
      <div className="sub-title">{t("liveStats")}</div>
      <div className="stats">
        <div>
          <CountUp from={status?.tweets_24h ?? 0} to={status?.tweets_24h ?? 0} duration={1} className="stat-num" />
          <div className="stat-label">{t("statTweets")}</div>
        </div>
        <div>
          <CountUp from={status?.hit_count_24h ?? 0} to={status?.hit_count_24h ?? 0} duration={1} className={"stat-num" + (hit ? " alert" : "")} />
          <div className="stat-label">{t("statHits")}</div>
        </div>
        <div>
          <span className="stat-num">{status ? status.poll_interval_minutes + " min" : "—"}</span>
          <div className="stat-label">{t("statInterval")}</div>
        </div>
      </div>
    </>
  );
}

/* GitHub 风格热力图：列=周、行=周一..周日，窗口固定 26 周（命中保留期 180 天）。
   日期一律按 UTC 日统计，与帖子区 UTC+0 时标口径一致；未来日期留空。
   默认选中 UTC 今天；选择历史日期后保留阅读位置，不随数据刷新跳回。 */
const HEAT_WEEKS = 26;

const pad2 = (n: number) => String(n).padStart(2, "0");

/* UTC 日（YYYY-MM-DD）→「周四 / Thu」；热力图按 UTC 日统计，星期也按 UTC 口径 */
function weekdayShort(day: string, lang: Lang): string {
  return new Intl.DateTimeFormat(lang === "zh" ? "zh-CN" : "en-US", {
    weekday: "short",
    timeZone: "UTC",
  }).format(new Date(day + "T00:00:00Z"));
}

/* 按 UTC 日期缓存明细；向前翻页直到越过目标日，避免最近 500 条截断旧日期。 */
const dayHitsCache = new Map<string, { at: number; list: Tweet[] }>();
async function loadDayHits(day: string, signal: AbortSignal): Promise<Tweet[]> {
  const cached = dayHitsCache.get(day);
  if (cached && Date.now() - cached.at < 60000) return cached.list;
  const list: Tweet[] = [];
  let before: string | undefined;
  for (;;) {
    const query = new URLSearchParams({ limit: "100" });
    if (before) query.set("before", before);
    const page = await j<Tweet[]>(`/api/hits?${query}`, { signal });
    list.push(...page.filter((tw) => tw.created_at.slice(0, 10) === day));
    const last = page.at(-1);
    if (!last || page.length < 100 || last.created_at.slice(0, 10) < day || last.id === before) break;
    before = last.id;
  }
  if (!signal.aborted) dayHitsCache.set(day, { at: Date.now(), list });
  return list;
}

function DayDetail({ day, id }: { day: string; id: string }) {
  const { t } = useTranslation();
  const lang = useLang();
  const [rows, setRows] = useState<Tweet[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void loadDayHits(day, AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]))
      .then((list) => { if (!controller.signal.aborted) setRows(list); })
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [day, retry]);
  const stamp = `${day} ${weekdayShort(day, lang)}`;
  const head = day === new Date().toISOString().slice(0, 10) ? t("heatTodayDetails", { day: stamp }) : stamp;
  return (
    <div className="day-detail" id={id} role="region" aria-label={t("heatDayDetails", { day })} aria-busy={rows == null && !failed}>
      <div className="dd-head">
        <span>{rows == null ? head : t(rows.length ? "heatTip" : "heatTipZero", { day: head, n: rows.length })}</span>
      </div>
      {failed ? <div className="dd-empty section-load-error" role="alert"><span>{t("heatLoadFail")}</span><button type="button" onClick={() => { setFailed(false); setRetry((n) => n + 1); }}>{t("postsRetry")}</button></div>
        : rows == null ? <div className="dd-empty" role="status">{t("heatLoading")}</div>
        : !rows.length ? <div className="dd-empty">{t("heatNoDetail")}</div>
        : rows.map((tw) => {
          const d = new Date(tw.created_at);
          return <a key={tw.id} className="dd-row" href={safeUrl(tw.url)} target="_blank" rel="noopener">
            <span className="dd-time">{localOffsetLabel()} {pad2(d.getHours())}:{pad2(d.getMinutes())}</span>
            <span className="dd-text" dangerouslySetInnerHTML={{ __html: hl(tw.text, tw.matched_terms) }} />
          </a>;
        })}
    </div>
  );
}

const RhythmHeatmap = memo(function RhythmHeatmap({ daily, selDay, onSelect, detailId, scrollRef }: { daily: { day: string; count: number }[]; selDay: string; onSelect: (day: string) => void; detailId: string; scrollRef: RefObject<HTMLDivElement | null> }) {
  const { t } = useTranslation();
  const lang = useLang();
  const [tip, setTip] = useState<{ x: number; y: number; day: string; n: number } | null>(null);
  const counts = new Map(daily.map((d) => [d.day, d.count]));
  const now = new Date();
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const todayStr = new Date(todayUtc).toISOString().slice(0, 10);
  // 本周周一（UTC）往前推 25 周，得到首列起点；getUTCDay 周日=0，换算为周一=0
  const mondayOffset = (new Date(todayUtc).getUTCDay() + 6) % 7;
  const start = todayUtc - (mondayOffset + (HEAT_WEEKS - 1) * 7) * 86400000;
  // 窄屏保留格子大小，首次进入直接呈现最近一周；数据更新不重置用户滚动位置。
  useLayoutEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    let keepLatest = true;
    let measuredWidth = scroll.clientWidth;
    const onScroll = () => {
      // 尺寸变化可能先触发 scroll，等观察器完成重排后再判断是否为用户向前浏览。
      if (scroll.clientWidth === measuredWidth) keepLatest = scroll.scrollWidth - scroll.clientWidth - scroll.scrollLeft < 2;
    };
    const observer = new ResizeObserver(() => {
      measuredWidth = scroll.clientWidth;
      if (keepLatest) scroll.scrollLeft = scroll.scrollWidth;
    });
    scroll.scrollLeft = scroll.scrollWidth;
    scroll.addEventListener("scroll", onScroll, { passive: true });
    observer.observe(scroll);
    return () => { observer.disconnect(); scroll.removeEventListener("scroll", onScroll); };
  }, [start, scrollRef]);
  const months: { column: number; end: number; label: string; key: string }[] = [];
  for (let c = 0; c < HEAT_WEEKS; c++) {
    // 月份标在包含月初的那一周，而不是拖到下一个周一。
    const date = new Date(Math.min(start + (c * 7 + 6) * 86400000, todayUtc));
    const key = `${date.getUTCFullYear()}-${date.getUTCMonth()}`;
    const previous = months.at(-1);
    if (previous?.key === key) previous.end = c + 1;
    else months.push({ column: c, end: c + 1, key, label: new Intl.DateTimeFormat(lang === "zh" ? "zh-CN" : "en-US", { month: "short", timeZone: "UTC" }).format(date) });
  }
  const cells = [];
  for (let c = 0; c < HEAT_WEEKS; c++) {
    for (let r = 0; r < 7; r++) {
      const ts = start + (c * 7 + r) * 86400000;
      const day = new Date(ts).toISOString().slice(0, 10);
      const position = { gridColumn: c + 2, gridRow: r + 2 };
      if (ts > todayUtc) { cells.push(<span key={day} className="heat-future" style={position} aria-hidden />); continue; }
      const n = counts.get(day) ?? 0;
      const level = n === 0 ? 0 : n === 1 ? 1 : n <= 3 ? 2 : n <= 6 ? 3 : 4;
      const label = t(n ? "heatTip" : "heatTipZero", { day: `${day} ${weekdayShort(day, lang)}`, n });
      const className = ["heat-cell", "hm-" + level, day === todayStr ? "today" : "", n > 0 ? "hit" : "", selDay === day ? "sel" : ""].filter(Boolean).join(" ");
      const showTip = (element: HTMLElement) => {
        const rect = element.getBoundingClientRect();
        setTip({ x: rect.left + rect.width / 2, y: rect.top, day, n });
      };
      cells.push(n > 0 || day === todayStr ? <button key={day} type="button" className={className} style={position}
        aria-label={label} aria-current={day === todayStr ? "date" : undefined} aria-pressed={selDay === day} aria-controls={detailId}
        onMouseEnter={(event) => showTip(event.currentTarget)} onFocus={(event) => showTip(event.currentTarget)} onBlur={() => setTip(null)}
        onClick={() => { setTip(null); onSelect(day); }}
        onKeyDown={(event) => { if (event.key === "Escape") setTip(null); }} />
        : <span key={day} className={className} style={position} onMouseEnter={(event) => showTip(event.currentTarget)} aria-hidden />);

    }
  }
  return (
    <>
      <div className="rhythm-heat heat-scroll" ref={scrollRef} role="region" aria-label={t("heatTitle")} tabIndex={0} onScroll={() => setTip(null)}>
        <div className="heat-grid" role="group" aria-label={t("heatTitle")} onMouseLeave={() => setTip(null)}>
          <span className="heat-axis-corner" aria-hidden />
          {months.map((month) => <span key={month.key} className="heat-month" style={{ gridColumn: `${month.column + 2} / ${month.end + 2}`, gridRow: 1 }} aria-hidden>{month.label}</span>)}
          {Array.from({ length: 7 }, (_, r) => <span key={r} className="heat-weekday" style={{ gridColumn: 1, gridRow: r + 2 }} aria-hidden>{t(`calWd${r + 1}`)}</span>)}
          {cells}
        </div>
      </div>
      <div className="heat-caption">
        <span>{t("heatRange", { start: new Date(start).toISOString().slice(0, 10), end: todayStr })}</span>
        <div className="rhythm-heat-legend">
        <span>{t("heatLess")}</span>
        {[0, 1, 2, 3, 4].map((l) => (
          <span key={l} className={`hm-cell hm-${l}`} />
        ))}
        <span>{t("heatMore")}</span>
        </div>
      </div>
      <p className="heat-help">{t("heatDailyHint")}</p>
      {/* 气泡挂 body：热力图在侧栏滚动容器内，fixed 定位 portal 出去避免被裁剪 */}
      {tip != null &&
        createPortal(
          <div
            className="heat-tip"
            style={{
              left: Math.max(8, Math.min(tip.x - 130, window.innerWidth - 268)),
              top: Math.max(64, tip.y - 38),
              maxWidth: "min(260px, calc(100vw - 16px))",
              whiteSpace: "normal",
            }}
          >
            {t(tip.n ? "heatTip" : "heatTipZero", { day: `${tip.day} ${weekdayShort(tip.day, lang)}`, n: tip.n })}
          </div>,
          document.body,
        )}
    </>
  );
});

export function RhythmCard({ stats }: { stats: Stats | null }) {
  const { t } = useTranslation();
  const today = new Date().toISOString().slice(0, 10);
  const [selection, setSelection] = useState<{ day: string; today: string }>(() => ({ day: today, today }));
  // 默认跟随 UTC 当天；人工选日后，后续刷新不覆盖用户的阅读状态。
  const selDay = selection.day === selection.today ? today : selection.day;
  const heatScrollRef = useRef<HTMLDivElement>(null);
  const detailId = useId();
  const selectDay = useCallback((day: string) => setSelection({ day, today }), [today]);
  const goToday = () => {
    setSelection({ day: today, today });
    const scroll = heatScrollRef.current;
    if (scroll) scroll.scrollLeft = scroll.scrollWidth;
  };
  if (!stats) {
    return (
      <>
        <h2 className="sub-title">{t("panelHeatTitle")}</h2>
        <div className="hempty">{t("rhythmEmpty")}</div>
      </>
    );
  }
  return (
    <>
      <div className="rhythm-head"><h2 className="sub-title">{t("panelHeatTitle")}</h2><span>{t("panelHeatRange")}</span><button className="heat-today-action" type="button" aria-label={t("heatBackToToday")} onClick={goToday}>{t("calToday")}</button></div>
      <RhythmHeatmap daily={stats.daily_hits || []} selDay={selDay} onSelect={selectDay} detailId={detailId} scrollRef={heatScrollRef} />
      <DayDetail key={selDay} day={selDay} id={detailId} />
    </>
  );
}

export function Sources({ status }: { status: Status | null }) {
  const { t } = useTranslation();
  const lang = useLang();
  const rows: ReactNode[] = [];
  if (status?.demo) {
    rows.push(
      <div className="srow" key="demo">
        <span className="dot ok" />
        <span className="sname">demo</span>
        <span className="sstate">{t("srcDemo")}</span>
      </div>,
    );
  }
  (status?.sources || [])
    .filter((s) => s.enabled)
    .forEach((s) => {
      let cls: string, label: string;
      if (!s.configured) {
        cls = "warn";
        label = t("stNoKey");
      } else if (!s.known) {
        cls = "warn";
        label = t("stWait");
      } else if (s.healthy) {
        cls = "ok";
        label = t("stOk", { ago: ago(s.last_ok, lang) });
      } else {
        cls = "bad";
        label = t("stFail", { n: s.failures });
      }
      rows.push(
        <div className="srow" key={s.name} title={s.last_error ? s.last_error : undefined}>
          <span className={`dot ${cls}`} />
          <span className="sname">{s.name}</span>
          <span className="sstate">{label}</span>
        </div>,
      );
    });
  return (
    <>
      <div className="sub-title">{t("dataSources")}</div>
      <div id="srcRows">
        {rows.length ? rows : (
          <div className="srow">
            <span className="dot warn" />
            <span className="sname">—</span>
            <span className="sstate">{t("srcEmpty")}</span>
          </div>
        )}
      </div>
    </>
  );
}

export function HitHistory({ hits }: { hits: Tweet[] }) {
  const { t } = useTranslation();
  return (
    <>
      <div className="sub-title">{t("hitHistory")}</div>
      <div id="hitList" className="hlist scroll-y">
        {hits.length ? (
          hits.map((tw) => (
            <a key={tw.id} className="hrow" href={safeUrl(tw.url)} target="_blank" rel="noopener" title={tw.created_at}>
              <span className="h-time">{fmt(tw.created_at)}</span>
              <span className="h-text" dangerouslySetInnerHTML={{ __html: hl(tw.text, tw.matched_terms) }} />
              <span className="pill pill-hit">{t("hitShort")}</span>
            </a>
          ))
        ) : (
          <div className="hempty">{t("hitEmpty")}</div>
        )}
      </div>
    </>
  );
}

const POLL_PAGE_SIZE = 10;

export function PollLog({ polls }: { polls: Poll[] }) {
  const { t } = useTranslation();
  const [rawPage, setPage] = useState(1);
  const total = polls.length;
  const pages = Math.max(1, Math.ceil(total / POLL_PAGE_SIZE));
  // 渲染期派生钳制，越界翻页（数据刷新后页数变少）自动落回合法页
  const page = Math.min(Math.max(1, rawPage), pages);
  const start = (page - 1) * POLL_PAGE_SIZE;

  return (
    <>
      <div className="log-head">
        <span className="sub-title" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <span>{t("pollLog")}</span>
          <span className="pill" title={t("pollLogTip")}>{t("logCount", { n: total })}</span>
        </span>
        <div className="pager">
          <button className="pg-btn" type="button" aria-label={t("prevPage")} disabled={page <= 1} onClick={() => setPage(page - 1)}>‹</button>
          <span className="pg-info">{page} / {pages}</span>
          <button className="pg-btn" type="button" aria-label={t("nextPage")} disabled={page >= pages} onClick={() => setPage(page + 1)}>›</button>
        </div>
      </div>
      <div id="pollList" className="loglist scroll-y">
        {total ? (
          polls.slice(start, start + POLL_PAGE_SIZE).map((p) => (
            <div key={p.id} className="logrow" title={p.error || ""}>
              <span className="log-time">{fmt(p.ts)}</span>
              <span className={`dot ${p.ok ? "ok" : "bad"}`} />
              <span className="log-src">{p.source || ""}</span>
              <span className="log-stat">
                {p.ok
                  ? t("okStat", { n: p.new_tweets ?? 0, ms: p.latency_ms != null ? p.latency_ms + "ms" : "—" })
                  : t("failStat")}
              </span>
              {p.error && <details className="initial-log-error"><summary>{t("errorDetails")}</summary><p>{p.error}</p></details>}
            </div>
          ))
        ) : (
          <div className="hempty">{t("logEmpty")}</div>
        )}
      </div>
    </>
  );
}
