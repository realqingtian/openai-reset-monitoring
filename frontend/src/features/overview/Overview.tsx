/* 阅读面板的节奏摘要、统计与系统详情：仅展示接口状态，不推断官方重置承诺。 */

import { memo, useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { j } from "../../api/client";
import type { Poll, SourceState, Stats, Status, Tweet } from "../../api/types";
import { ago, fmt, hl, localOffsetLabel, safeUrl } from "../../utils/format";
import { useLang } from "../../i18n/useLang";
import type { Lang } from "../../utils/format";
import CountUp from "../../components/reactbits/CountUp";
import { TestNotifyButton } from "../../components/TestNotifyButton";

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
  const clock = `${String(Math.floor((s % 86400) / 3600)).padStart(2, "0")}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  return d > 0 ? (lang === "zh" ? `${d}天 ${clock}` : `${d}d ${clock}`) : clock;
}

function fmtHours(h: number, lang: Lang): string {
  if (h >= 48) return lang === "zh" ? (h / 24).toFixed(1) + " 天" : (h / 24).toFixed(1) + " d";
  return lang === "zh" ? Math.round(h) + " 小时" : Math.round(h) + " h";
}

/* ---------- 阅读页标题与监控状态 ---------- */

export function MonitorIntro({ status, view }: { status: Status | null; view: "feed" | "rhythm" | "system" }) {
  const { t } = useTranslation();
  const lang = useLang();
  const sources = (status?.sources || []).filter((source) => source.enabled);
  const usable = sources.filter((source) => source.configured);
  const healthy = status?.demo || usable.some((source) => source.known && source.healthy);
  const failed = usable.length > 0 && usable.every((source) => source.known && !source.healthy);
  const state = !status ? "monitorLoading" : healthy ? "monitorHealthy" : failed ? "monitorFailed" : !usable.length ? "monitorUnconfigured" : "stWait";
  const tone = healthy ? "ok" : failed ? "bad" : "warn";
  const accounts = (status?.accounts || []).map((account) => "@" + account).join(lang === "zh" ? "、" : ", ");
  return (
    <div className="reading-intro">
      <h1 className="sr-only">{t(view === "feed" ? "navFeed" : view === "rhythm" ? "navRhythm" : "sysTitle")}</h1>
      <div className={"monitor-line " + tone}>
        <span className={"dot " + tone} aria-hidden />
        <span>{t("pulseWatch", { acc: accounts || "—" })}</span>
        <span>·</span><span>{t(state)}</span>
        <span className="monitor-last">{t("pulseLastCheck", { ago: ago(status?.last_poll_at, lang) })}</span>
      </div>
      <p className="sr-only">{t(view === "feed" ? "readingDescription" : view === "rhythm" ? "rhythmDescription" : "systemDescription")}</p>
    </div>
  );
}

/* ---------- 旁栏节奏：预测明确标注参考属性，逾期状态继续可见 ---------- */

export function NextResetCard({ status, stats }: { status: Status | null; stats: Stats | null }) {
  const { t } = useTranslation();
  const lang = useLang();
  const now = useNow();
  const avgMs = (stats?.avg_interval_hours ?? 0) * 3600e3;
  const lastMs = Date.parse(stats?.last_hit_at || "");
  const hasCycle = !!stats?.total_hits && avgMs > 0 && Number.isFinite(lastMs);
  const expectedMs = lastMs + avgMs;
  const overdue = hasCycle && now > expectedMs;
  const dateLabel = (ms: number) => new Intl.DateTimeFormat(lang === "zh" ? "zh-CN" : "en-US", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date(ms));

  return (
    <section className="reset-summary" aria-label={t("nextResetTitle")}>
      <div className="aside-heading"><h2>{t("navRhythm")}</h2>{status?.demo && <span className="badge-demo">{t("demoLabel")}</span>}</div>
      {hasCycle ? (
        <>
          <div className="reset-expected" title={fmt(new Date(expectedMs).toISOString())}>{t("expectedAt", { time: dateLabel(expectedMs) })}</div>
          <p className="reset-disclaimer">{t("predictionDisclaimer")}</p>
          <div className={"reset-countdown" + (overdue ? " over" : "")}>
            <span>{fmtCountdown(overdue ? now - expectedMs : expectedMs - now, lang)}</span>
            <span className="reset-count-label">{t(overdue ? "rhythmCdOver" : "rhythmCdWait")}</span>
          </div>
          {overdue && <p className="reset-overdue">{t("rhythmStateOver")}</p>}
        </>
      ) : <p className="reset-no-data">{t("rhythmNoForecast")}</p>}
      <dl className="reset-facts">
        <div><dt>{t("rhythmLast")}</dt><dd title={fmt(stats?.last_hit_at)}>{Number.isFinite(lastMs) ? dateLabel(lastMs) : "—"}</dd></div>
        <div><dt>{t("rhythmAvg")}</dt><dd title={t("rhythmAvgTip")}>{stats?.avg_interval_hours != null ? fmtHours(stats.avg_interval_hours, lang) : "—"}</dd></div>
      </dl>
    </section>
  );
}

/* ---------- 页末统计条：与公告阅读区分离，避免数字争夺首屏 ---------- */

export function PulseCard({ status }: { status: Status | null }) {
  const { t } = useTranslation();
  return (
    <div className="reading-stats" aria-label={t("liveStats")}>
      <span className="stats-heading">{t("liveStats")}</span>
      <span><CountUp from={status?.tweets_24h ?? 0} to={status?.tweets_24h ?? 0} duration={1} /> {t("statTweets")}</span>
      <span><CountUp from={status?.hit_count_24h ?? 0} to={status?.hit_count_24h ?? 0} duration={1} /> {t("statHits")}</span>
      <span>{status ? status.poll_interval_minutes + " min" : "—"} {t("statInterval")}</span>
      {status?.demo && <span className="stats-note">{t("demoNote")}</span>}
    </div>
  );
}

/* ---------- 命中热力宽幅横条 ---------- */

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

/* 当日命中明细：面板默认只带最近 20 条，热力图 26 周覆盖不了，首次点击时全量拉一次并短缓存 */
let dayHitsCache: { at: number; list: Tweet[] } | null = null;
async function loadAllHits(): Promise<Tweet[]> {
  if (dayHitsCache && Date.now() - dayHitsCache.at < 60000) return dayHitsCache.list;
  const list = await j<Tweet[]>("/api/hits?limit=500");
  dayHitsCache = { at: Date.now(), list };
  return list;
}

function DayDetail({ day, onClose }: { day: string; onClose: () => void }) {
  const { t } = useTranslation();
  const lang = useLang();
  // null = 加载中；[] = 拉到了但该日不在缓存范围（理论上极少：超出最近 500 条）
  const [rows, setRows] = useState<Tweet[] | null>(null);
  useEffect(() => {
    let alive = true;
    loadAllHits()
      .then((list) => {
        if (alive) setRows(list.filter((tw) => (tw.created_at || "").slice(0, 10) === day));
      })
      .catch(() => {
        if (alive) setRows([]);
      });
    return () => {
      alive = false;
    };
  }, [day]);
  const head = `${day} ${weekdayShort(day, lang)}`;
  return (
    <div className="day-detail">
      <div className="dd-head">
        <span>{rows == null ? head : t(rows.length ? "heatTip" : "heatTipZero", { day: head, n: rows.length })}</span>
        <button className="dd-close" type="button" aria-label={t("ddClose")} onClick={onClose}>
          ×
        </button>
      </div>
      {rows == null ? (
        <div className="dd-empty">{t("heatLoading")}</div>
      ) : rows.length === 0 ? (
        <div className="dd-empty">{t("heatNoDetail")}</div>
      ) : (
        rows.map((tw) => {
          const d = new Date(tw.created_at);
          return (
            <a key={tw.id} className="dd-row" href={safeUrl(tw.url)} target="_blank" rel="noopener">
              <span className="dd-time">
                {localOffsetLabel()} {pad2(d.getHours())}:{pad2(d.getMinutes())}
              </span>
              <span className="dd-text" dangerouslySetInnerHTML={{ __html: hl(tw.text, tw.matched_terms) }} />
            </a>
          );
        })
      )}
    </div>
  );
}

const RhythmHeatmap = memo(function RhythmHeatmap({ daily }: { daily: { day: string; count: number }[] }) {
  const { t } = useTranslation();
  const lang = useLang();
  const [tip, setTip] = useState<{ x: number; y: number; day: string; n: number } | null>(null);
  const [selDay, setSelDay] = useState<string | null>(null);
  const counts = new Map(daily.map((d) => [d.day, d.count]));
  const now = new Date();
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const todayStr = new Date(todayUtc).toISOString().slice(0, 10);
  // 本周周一（UTC）往前推 25 周，得到首列起点；getUTCDay 周日=0，换算为周一=0
  const mondayOffset = (new Date(todayUtc).getUTCDay() + 6) % 7;
  const start = todayUtc - (mondayOffset + (HEAT_WEEKS - 1) * 7) * 86400000;
  // GitHub 风格 gutter（以格子为单位）：GX=左侧星期标签栏 3 格，GY=顶部月份标签栏 0.9 格
  const GX = 3;
  const GY = 0.9;
  const cells = [];
  for (let c = 0; c < HEAT_WEEKS; c++) {
    for (let r = 0; r < 7; r++) {
      const ts = start + (c * 7 + r) * 86400000;
      const day = new Date(ts).toISOString().slice(0, 10);
      if (ts > todayUtc) continue; // 未来日期不画
      const n = counts.get(day) ?? 0;
      const level = n === 0 ? 0 : n === 1 ? 1 : n <= 3 ? 2 : n <= 6 ? 3 : 4;
      cells.push(
        <rect
          key={day}
          x={GX + c + 0.08}
          y={GY + r + 0.08}
          width={0.84}
          height={0.84}
          rx={0.18}
          className={["hm-" + level, day === todayStr ? "today" : "", n > 0 ? "hit" : "", selDay === day ? "sel" : ""]
            .filter(Boolean)
            .join(" ")}
          role={n > 0 ? "button" : undefined}
          tabIndex={n > 0 ? 0 : undefined}
          aria-label={n > 0 ? t("heatTip", { day, n }) : undefined}
          onFocus={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            setTip({ x: rect.left, y: rect.bottom, day, n });
          }}
          onBlur={() => setTip(null)}
          onKeyDown={(e) => {
            if (n > 0 && (e.key === "Enter" || e.key === " ")) {
              e.preventDefault();
              setSelDay((current) => current === day ? null : day);
            }
          }}
          onMouseMove={(e) => setTip({ x: e.clientX, y: e.clientY, day, n })}
          onClick={() => n > 0 && setSelDay((cur) => (cur === day ? null : day))}
        />,
      );
    }
  }
  const closeDay = useCallback(() => setSelDay(null), []);
  // GitHub 风格版式：方形格子（默认等比缩放），顶部月份标签、左侧周一/周三/周五标签
  const locale = lang === "zh" ? "zh-CN" : "en-US";
  const monthLabels: { x: number; label: string }[] = [];
  let lastLabelCol = -3;
  for (let c = 1; c < HEAT_WEEKS; c++) {
    const monday = new Date(start + c * 7 * 86400000);
    const prev = new Date(start + (c - 1) * 7 * 86400000);
    if (
      monday.getUTCMonth() !== prev.getUTCMonth() &&
      c - lastLabelCol >= 3 &&
      c <= HEAT_WEEKS - 2
    ) {
      monthLabels.push({
        x: GX + c,
        label: new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" }).format(monday),
      });
      lastLabelCol = c;
    }
  }
  const total = daily.reduce((acc, d) => acc + d.count, 0);
  return (
    <>
      <div className="heat-body">
        <svg className="rhythm-heat" viewBox={`0 0 ${GX + HEAT_WEEKS} ${GY + 7}`} role="group" aria-label={t("heatTitle")} onMouseLeave={() => setTip(null)}>
          {monthLabels.map((m) => (
            <text key={m.x} className="hm-label" x={m.x} y={0.58}>
              {m.label}
            </text>
          ))}
          {[0, 2, 4].map((r) => (
            <text key={r} className="hm-label" x={GX - 0.35} y={GY + r + 0.56} textAnchor="end">
              {t(`calWd${r + 1}`)}
            </text>
          ))}
          {cells}
        </svg>
        <div className="heat-side">
          <div className="heat-total">
            <span className="heat-total-num">
              <CountUp from={total} to={total} duration={1} />
            </span>
            <span className="heat-total-label">{t("heatTotal", { weeks: HEAT_WEEKS })}</span>
          </div>
          <div className="rhythm-heat-legend">
            <span>{t("heatLess")}</span>
            {[1, 2, 3, 4].map((l) => (
              <span key={l} className={`hm-cell hm-${l}`} />
            ))}
            <span>{t("heatMore")}</span>
          </div>
        </div>
      </div>
      {/* 气泡挂 body：热力图在滚动容器内，fixed 定位 portal 出去避免被裁剪 */}
      {tip != null &&
        createPortal(
          <div
            className="heat-tip"
            style={{
              left: Math.min(tip.x + 12, window.innerWidth - 190),
              top: Math.max(30, tip.y - 34),
            }}
          >
            {t(tip.n ? "heatTip" : "heatTipZero", { day: `${tip.day} ${weekdayShort(tip.day, lang)}`, n: tip.n })}
          </div>,
          document.body,
        )}
      {/* key=day：切换日期即重挂载，加载态由初始 useState(null) 表达，无需 effect 内重置 */}
      {selDay != null && <DayDetail key={selDay} day={selDay} onClose={closeDay} />}
    </>
  );
});

export function HeatTile({ stats }: { stats: Stats | null }) {
  const { t } = useTranslation();
  return (
    <div className="card">
      <div className="card-core">
        <div className="aside-heading"><h2>{t("heatTitle")}</h2><span className="reset-disclaimer">{t("rhythmHits30")} · {stats?.hits_30d ?? "—"}</span></div>
        {stats?.daily_hits?.length ? (
          <RhythmHeatmap daily={stats.daily_hits} />
        ) : (
          <div className="hempty">{t("rhythmEmpty")}</div>
        )}
      </div>
    </div>
  );
}

/* ---------- 系统状态：数据源 / 通知渠道 / AI 能力 ｜ 检查日志（左右分栏） ---------- */

function sourceLabel(source: SourceState, t: (key: string, values?: Record<string, unknown>) => string, lang: Lang) {
  if (!source.enabled) return { tone: "idle", text: t("stDisabled") };
  if (!source.configured) return { tone: "warn", text: t("stNoKey") };
  if (!source.known) return { tone: "warn", text: t("stWait") };
  if (source.healthy) return { tone: "ok", text: t("stOk", { ago: ago(source.last_ok, lang) }) };
  return { tone: "bad", text: t("stFail", { n: source.failures }) };
}

export function SourcesCol({ status }: { status: Status | null }) {
  const { t } = useTranslation();
  const lang = useLang();
  const ai = status?.ai;
  const sources = status?.sources || [];
  const notifiers = status?.notifiers || [];
  const anyReady = notifiers.some((n) => n.enabled && n.configured);
  return (
    <div className="system-sections">
      <section className="system-section" aria-labelledby="sourcesTitle">
        <h2 id="sourcesTitle" className="section-heading">{t("dataSources")}</h2>
        <div className="source-rows">
          {status?.demo && <div className="srow"><span className="sname">{t("srcDemo")}</span><span className="state-label ok"><span className="dot ok" />{t("monitorHealthy")}</span></div>}
          {sources.map((source) => {
            const state = sourceLabel(source, t, lang);
            return <div className="srow" key={source.name} title={source.last_error || undefined}>
              <span className="sname">{source.name === "rsshub" ? "RSSHub" : source.name === "twitterapi_io" ? "TwitterAPI.io" : source.name}</span>
              <span className={"state-label " + state.tone}><span className={"dot " + state.tone} />{state.text}</span>
              {source.last_error && <details className="source-error"><summary>{t("errorDetails")}</summary><p>{source.last_error}</p></details>}
            </div>;
          })}
          {!status && <p className="hempty">{t("monitorLoading")}</p>}
          {status && !status.demo && !sources.some((source) => source.enabled) && <p className="section-note">{t("srcEmpty")}</p>}
        </div>
      </section>
      <section className="system-section" aria-labelledby="notifiersTitle">
        <h2 id="notifiersTitle" className="section-heading">{t("notifyChannels")}</h2>
        <div className="notifier-rows">
          {notifiers.map((channel) => {
            const ready = channel.enabled && channel.configured;
            const tone = ready ? "ok" : channel.enabled ? "warn" : "idle";
            return <div className="srow" key={channel.name}>
              <span className="sname">{t("channel_" + channel.name, { defaultValue: channel.name })}</span>
              <span className={"state-label " + tone}><span className={"dot " + tone} />{t(ready ? "ntReady" : channel.enabled ? "stUnconfigured" : "stDisabled")}</span>
            </div>;
          })}
        </div>
        {!anyReady && <p className="section-note">{t("notifHint")}</p>}
        {status?.demo && <p className="section-note">{t("demoNotifyHint")}</p>}
      </section>
      <section className="system-section" aria-labelledby="aiTitle">
        <h2 id="aiTitle" className="section-heading">{t("aiCap")}</h2>
        {ai?.enabled ? <>
          <div className="srow"><span className="sname">{t("aiProvider")}</span><span className="svalue">{ai.provider} · {ai.model}</span></div>
          <div className="srow"><span className="sname">{t("aiReviewLabel")}</span><span className={"state-label " + (ai.review ? "ok" : "idle")}><span className={"dot " + (ai.review ? "ok" : "idle")} />{t(ai.review ? "stEnabled" : "stDisabled")}</span></div>
          <p className="section-note">{t("aiTranslateOn")}</p>
        </> : <p className="section-note ai-unconfigured"><span className="dot warn" />{t("aiOff")}</p>}
      </section>
    </div>
  );
}

const POLL_PAGE_SIZE = 10;

export function PollLog({ polls }: { polls: Poll[] }) {
  const { t } = useTranslation();
  const [rawPage, setPage] = useState(1);
  const total = polls.length;
  const pages = Math.max(1, Math.ceil(total / POLL_PAGE_SIZE));
  // 刷新使总页数缩小时，派生当前页避免留在空白页。
  const page = Math.min(Math.max(1, rawPage), pages);
  const start = (page - 1) * POLL_PAGE_SIZE;
  return (
    <section className="system-section log-section" aria-labelledby="pollTitle">
      <div className="log-head">
        <h2 id="pollTitle" className="section-heading">{t("pollLog")} <span className="pill" title={t("pollLogTip")}>{t("logCount", { n: total })}</span></h2>
      </div>
      <p className="section-note log-note">{t("pollLogTip")}</p>
      <div className="log-table-wrap" tabIndex={0} role="region" aria-label={t("pollLog")}>
        <table className="log-table">
          <thead><tr>{["logTime", "logSource", "logState", "logPosts", "logLatency"].map((key) => <th key={key} scope="col">{t(key)}</th>)}</tr></thead>
          <tbody>{total ? polls.slice(start, start + POLL_PAGE_SIZE).map((poll) => <tr key={poll.id}>
            <td><time dateTime={poll.ts || undefined} title={fmt(poll.ts)}>{fmt(poll.ts)}</time></td>
            <td>{poll.source || "—"}</td>
            <td><span className={"state-label " + (poll.ok ? "ok" : "bad")}><span className={"dot " + (poll.ok ? "ok" : "bad")} />{t(poll.ok ? "logSuccess" : "failStat")}</span>{poll.error && <details className="log-error"><summary>{t("errorDetails")}</summary><p>{poll.error}</p></details>}</td>
            <td className="numeric">{poll.new_tweets ?? "—"}</td>
            <td className="numeric">{poll.latency_ms != null ? poll.latency_ms + "ms" : "—"}</td>
          </tr>) : <tr><td colSpan={5} className="hempty">{t("logEmpty")}</td></tr>}</tbody>
        </table>
      </div>
      <div className="pager">
        <button className="pg-btn" type="button" aria-label={t("prevPage")} disabled={page <= 1} onClick={() => setPage(page - 1)}>‹</button>
        <span className="pg-info" aria-live="polite">{page} / {pages}</span>
        <button className="pg-btn" type="button" aria-label={t("nextPage")} disabled={page >= pages} onClick={() => setPage(page + 1)}>›</button>
      </div>
    </section>
  );
}

export function SystemCard({ status, polls }: { status: Status | null; polls: Poll[] }) {
  const { t } = useTranslation();
  return (
    <div className="system-layout">
      <div className="system-config">
        <SourcesCol status={status} />
        {status?.debug && <section className="system-section debug-section" aria-labelledby="debugTitle">
          <div className="aside-heading"><h2 id="debugTitle">{t("debugTitle")}</h2><span className="pill">{t("debugMode")}</span></div>
          <p className="section-note">{t("debugNotifyDescription")}</p>
          <TestNotifyButton />
        </section>}
      </div>
      <PollLog polls={polls} />
    </div>
  );
}

/* ---------- 历史命中 ---------- */

export function HitHistory({ hits }: { hits: Tweet[] }) {
  const { t } = useTranslation();
  return (
    <div className="card">
      <div className="card-core">
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
      </div>
    </div>
  );
}
