/* 右栏卡片：实时统计（React Bits CountUp 数字动画）、重置节奏、数据源、通知渠道、历史命中、检查日志分页。 */

import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { Poll, Stats, Status, Tweet } from "../../api/types";
import { ago, esc, fmt, fmtLocal, hl, safeUrl } from "../../utils/format";
import { useLang } from "../../i18n/useLang";
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

/* 迷你时间线：每个命中一根竖条，x 按时间比例分布；样本不足 2 个画不出间隔，直接省略 */
function RhythmSpark({ times, fmtTs }: { times: string[]; fmtTs: (iso: string) => string }) {
  if (times.length < 2) return null;
  const t0 = new Date(times[0]).getTime();
  const tN = new Date(times[times.length - 1]).getTime();
  const span = Math.max(1, tN - t0);
  return (
    <svg className="rhythm-spark" viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden>
      <line className="spk-base" x1={0} y1={25.5} x2={100} y2={25.5} />
      {times.map((ts, i) => {
        const x = 2 + ((new Date(ts).getTime() - t0) / span) * 96;
        const last = i === times.length - 1;
        const h = last ? 12 : 8;
        return (
          <rect key={ts} x={+x.toFixed(1)} y={24 - h} width={2.4} height={h} rx={1.2} className={last ? "spk-last" : ""}>
            <title>{fmtTs(ts)}</title>
          </rect>
        );
      })}
    </svg>
  );
}

export function RhythmCard({ stats }: { stats: Stats | null }) {
  const { t } = useTranslation();
  const lang = useLang();
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
  return (
    <>
      <div className="sub-title">{t("rhythmTitle")}</div>
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
      {stats.next_expected_at ? (
        <div className="rhythm-next" title={t("rhythmNextTip")}>
          <span className="r-key">{t("rhythmNext")}</span> {fmtLocal(stats.next_expected_at)}
        </div>
      ) : (
        <div className="rhythm-next">
          <span className="r-key">{t("rhythmNoForecast")}</span>
        </div>
      )}
      <RhythmSpark times={stats.recent_hits} fmtTs={(iso) => fmt(iso)} />
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
      <div className="divider" />
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
