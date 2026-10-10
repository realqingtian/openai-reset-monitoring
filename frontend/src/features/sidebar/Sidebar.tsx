/* 右栏卡片：实时统计（React Bits CountUp 数字动画）、重置节奏、数据源、通知渠道、历史命中、检查日志分页。 */

import { memo, useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { j } from "../../api/client";
import type { Poll, Stats, Status, Tweet } from "../../api/types";
import { ago, fmt, fmtLocal, fmtUTC, hl, localOffsetLabel, safeUrl } from "../../utils/format";
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
   交互：悬停即时气泡（替代延迟高的原生 title），点击命中格在图下方展开当日明细。 */
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

function DayDetail({ day, id, onClose }: { day: string; id: string; onClose: () => void }) {
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
  const head = `${day} ${weekdayShort(day, lang)}`;
  return (
    <div className="day-detail" id={id} role="region" aria-label={t("heatDayDetails", { day })} aria-busy={rows == null && !failed}>
      <div className="dd-head">
        <span>{rows == null ? head : t(rows.length ? "heatTip" : "heatTipZero", { day: head, n: rows.length })}</span>
        <button className="dd-close" type="button" aria-label={t("ddClose")} onClick={onClose}>×</button>
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

const RhythmHeatmap = memo(function RhythmHeatmap({ daily, selDay, onSelect, detailId }: { daily: { day: string; count: number }[]; selDay: string | null; onSelect: (day: string) => void; detailId: string }) {
  const { t } = useTranslation();
  const lang = useLang();
  const [tip, setTip] = useState<{ x: number; y: number; day: string; n: number } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
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
    if (scroll) scroll.scrollLeft = scroll.scrollWidth;
  }, [start]);
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
      cells.push(n > 0 ? <button key={day} type="button" className={className} style={position}
        aria-label={label} aria-pressed={selDay === day} aria-expanded={selDay === day} aria-controls={detailId}
        onMouseEnter={(event) => showTip(event.currentTarget)} onFocus={(event) => showTip(event.currentTarget)} onBlur={() => setTip(null)}
        onClick={() => { setTip(null); onSelect(day); }}
        onKeyDown={(event) => { if (event.key === "Escape") { setTip(null); if (selDay) onSelect(selDay); } }} />
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

/* 逐秒刷新的本地时钟：倒计时与进度条的「活着」来源（数据仍 60s 拉新，走动不依赖轮询） */
function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/* 时长压缩：>24h 为「N天 HH:MM:SS」，否则「HH:MM:SS」 */
function fmtCountdown(ms: number, lang: Lang): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400);
  const clock = `${pad2(Math.floor((s % 86400) / 3600))}:${pad2(Math.floor((s % 3600) / 60))}:${pad2(s % 60)}`;
  return d > 0 ? (lang === "zh" ? `${d}天 ${clock}` : `${d}d ${clock}`) : clock;
}

export function RhythmCard({ stats }: { stats: Stats | null }) {
  const { t } = useTranslation();
  const lang = useLang();
  const now = useNow();
  const [selDay, setSelDay] = useState<string | null>(null);
  const detailId = useId();
  const selectDay = useCallback((day: string) => setSelDay((old) => old === day ? null : day), []);
  const closeDay = useCallback(() => {
    document.getElementById(detailId)?.parentElement?.querySelector<HTMLButtonElement>('.heat-cell.sel')?.focus();
    setSelDay(null);
  }, [detailId]);
  if (!stats || !stats.total_hits) {
    return (
      <>
        <h2 className="sub-title">{t("rhythmTitle")}</h2>
        <div className="hempty">{t("rhythmEmpty")}</div>
      </>
    );
  }
  const fmtHours = (h: number) => {
    if (h >= 48) return lang === "zh" ? (h / 24).toFixed(1) + " 天" : (h / 24).toFixed(1) + " d";
    return lang === "zh" ? Math.round(h) + " 小时" : Math.round(h) + " h";
  };
  // 节奏状态机：距上次命中的进度 vs 平均间隔；越过预计点即「已逾期」态（琥珀），等待态每秒走动
  const avgMs = (stats.avg_interval_hours ?? 0) * 3600e3;
  const lastMs = Date.parse(stats.last_hit_at || "");
  const hasCycle = stats.avg_interval_hours != null && avgMs > 0 && Number.isFinite(lastMs);
  const predictedMs = Date.parse(stats.next_expected_at || "");
  const expectedMs = Number.isFinite(predictedMs) ? predictedMs : lastMs + avgMs;
  const overdue = hasCycle && now > expectedMs;
  const pct = hasCycle ? Math.min(100, ((now - lastMs) / avgMs) * 100) : 0;
  return (
    <>
      <div className="rhythm-head"><h2 className="sub-title">{t("rhythmTitle")}</h2>
        {hasCycle && (
          <span className={"state-pill " + (overdue ? "over" : "wait")}>
            <span className="dot" aria-hidden />
            {overdue ? t("rhythmStateOver") : t("rhythmStateWait")}
          </span>
        )}
        <p className="rhythm-reference">{t("predictionDisclaimer")}</p>
      </div>
      <div className="rhythm-layout"><div className="rhythm-metrics">
      {hasCycle && (<div
            className={"count-line" + (overdue ? " over" : "")}
            title={`UTC+0 ${fmtUTC(new Date(expectedMs).toISOString())} · ${localOffsetLabel()} ${fmtLocal(new Date(expectedMs).toISOString())}`}
          >
            <span className="r-key">{overdue ? t("rhythmCdOver") : t("rhythmCdWait")}</span>
            <span className="cd">{fmtCountdown(overdue ? now - expectedMs : expectedMs - now, lang)}</span>
            {overdue && (
              <span className="cd-sub">{t("rhythmOverPast", { t: fmtLocal(new Date(expectedMs).toISOString()).slice(0, 16) })}</span>
            )}
          </div>)}
      <div className="rhythm-rows">
        <div className="r-row" title={stats.last_hit_at || ""}>
          <span className="r-key">{t("rhythmLast")}</span>
          <span className="r-val">{ago(stats.last_hit_at, lang)}</span>
        </div>
        <div className="r-row" title={t("rhythmAvgTip")}>
          <span className="r-key">{t("rhythmAvg")}</span>
          <span className="r-val">{stats.avg_interval_hours != null ? fmtHours(stats.avg_interval_hours) : "—"}</span>
        </div>
        <div className="r-row" title={t("rhythmTotal", { n: stats.total_hits })}>
          <span className="r-key">{t("rhythmHits30")}</span>
          <span className="r-val">{String(stats.hits_30d)}</span>
        </div>
      </div>
      {hasCycle ? (
        <>
          <div
            className={"rhythm-bar" + (overdue ? " over" : "")}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(pct)}
            title={t("rhythmNextTip")}
          >
            <div className="bar-track">
              <div className="bar-fill" style={{ width: pct.toFixed(1) + "%" }} />
            </div>
            <div className="bar-meta">
              <span>{overdue ? t("rhythmBeyond") : t("rhythmCycle")}</span>
              <span className="pct">
                {overdue ? t("rhythmTimes", { n: ((now - lastMs) / avgMs).toFixed(1) }) : Math.round(pct) + "%"}
              </span>
            </div>
          </div>

        </>
      ) : (
        <div className="rhythm-next">
          <span className="r-key">{t("rhythmNoForecast")}</span>
        </div>
      )}
      </div><div className="rhythm-activity"><h3>{t("heatTitle")}</h3><RhythmHeatmap daily={stats.daily_hits || []} selDay={selDay} onSelect={selectDay} detailId={detailId} /></div></div>
      {selDay && <DayDetail key={selDay} day={selDay} id={detailId} onClose={closeDay} />}
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
