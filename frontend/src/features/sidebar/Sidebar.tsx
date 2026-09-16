/* 右栏卡片：实时统计（React Bits CountUp 数字动画）、重置节奏、数据源、通知渠道、历史命中、检查日志分页。 */

import { memo, useCallback, useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { j } from "../../api/client";
import type { Poll, Stats, Status, Tweet } from "../../api/types";
import { ago, esc, fmt, fmtLocal, fmtUTC, hl, localOffsetLabel, safeUrl } from "../../utils/format";
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
          <CountUp to={status?.tweets_24h ?? 0} duration={1} className="stat-num" />
          <div className="stat-label">{t("statTweets")}</div>
        </div>
        <div>
          <CountUp to={status?.hit_count_24h ?? 0} duration={1} className={"stat-num" + (hit ? " alert" : "")} />
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
          x={c + 0.08}
          y={r + 0.08}
          width={0.84}
          height={0.84}
          rx={0.18}
          className={["hm-" + level, day === todayStr ? "today" : "", n > 0 ? "hit" : "", selDay === day ? "sel" : ""]
            .filter(Boolean)
            .join(" ")}
          onMouseMove={(e) => setTip({ x: e.clientX, y: e.clientY, day, n })}
          onClick={() => n > 0 && setSelDay((cur) => (cur === day ? null : day))}
        />,
      );
    }
  }
  const closeDay = useCallback(() => setSelDay(null), []);
  return (
    <>
      <svg className="rhythm-heat" viewBox={`0 0 ${HEAT_WEEKS} 7`} aria-hidden onMouseLeave={() => setTip(null)}>
        {cells}
      </svg>
      <div className="rhythm-heat-legend">
        <span>{t("heatLess")}</span>
        {[1, 2, 3, 4].map((l) => (
          <span key={l} className={`hm-cell hm-${l}`} />
        ))}
        <span>{t("heatMore")}</span>
      </div>
      {/* 气泡挂 body：热力图在侧栏滚动容器内，fixed 定位 portal 出去避免被裁剪 */}
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
  if (!stats || !stats.total_hits) {
    return (
      <>
        <div className="sub-title">{t("rhythmTitle")}</div>
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
  const expectedMs = lastMs + avgMs;
  const overdue = hasCycle && now > expectedMs;
  const pct = hasCycle ? Math.min(100, ((now - lastMs) / avgMs) * 100) : 0;
  return (
    <>
      <div className="sub-title rhythm-head">
        <span>{t("rhythmTitle")}</span>
        {hasCycle && (
          <span className={"state-pill " + (overdue ? "over" : "wait")}>
            <span className="dot" aria-hidden />
            {overdue ? t("rhythmStateOver") : t("rhythmStateWait")}
          </span>
        )}
      </div>
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
          <div
            className={"count-line" + (overdue ? " over" : "")}
            title={`UTC+0 ${fmtUTC(new Date(expectedMs).toISOString())} · ${localOffsetLabel()} ${fmtLocal(new Date(expectedMs).toISOString())}`}
          >
            <span className="r-key">{overdue ? t("rhythmCdOver") : t("rhythmCdWait")}</span>
            <span className="cd">{fmtCountdown(overdue ? now - expectedMs : expectedMs - now, lang)}</span>
            {overdue && (
              <span className="cd-sub">{t("rhythmOverPast", { t: fmtLocal(new Date(expectedMs).toISOString()).slice(0, 16) })}</span>
            )}
          </div>
        </>
      ) : (
        <div className="rhythm-next">
          <span className="r-key">{t("rhythmNoForecast")}</span>
        </div>
      )}
      {stats.daily_hits?.length ? <RhythmHeatmap daily={stats.daily_hits} /> : null}
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
        <div className="srow" key={s.name} title={s.last_error ? esc(s.last_error) : undefined}>
          <span className={`dot ${cls}`} />
          <span className="sname">{esc(s.name)}</span>
          <span className="sstate">{label}</span>
        </div>,
      );
    });
  const ntf: ReactNode[] = [];
  let okCount = 0;
  (status?.notifiers || [])
    .filter((n) => n.enabled)
    .forEach((n) => {
      const cls = n.configured ? "ok" : "warn";
      const label = n.configured ? t("ntReady") : t("stNoKey");
      if (n.configured) okCount++;
      ntf.push(
        <span key={n.name} className="npill">
          <span className={`dot ${cls}`} />
          {esc(n.name)} · {label}
        </span>,
      );
    });
  if (okCount === 0) ntf.push(<span key="hint" className="npill">{t("notifHint")}</span>);

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
      <div className="divider" />
      <div className="sub-title">{t("notifyChannels")}</div>
      <div className="npills">{ntf}</div>
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
              <span className="log-src">{esc(p.source || "")}</span>
              <span className="log-stat">
                {p.ok
                  ? t("okStat", { n: p.new_tweets ?? 0, ms: p.latency_ms != null ? p.latency_ms + "ms" : "—" })
                  : t("failStat")}
              </span>
            </div>
          ))
        ) : (
          <div className="hempty">{t("logEmpty")}</div>
        )}
      </div>
    </>
  );
}
