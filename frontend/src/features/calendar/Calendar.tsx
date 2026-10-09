/* 重置日历：月历视图展示命中重置事件（额度重置 / 发重置卡）与下次重置预测。
   日期一律按访问者本地时区归日（后端给 UTC 事件流 + ±2 天缓冲，这里裁回当月）；
   事件状态按「公告到生效滞后 6 小时」的展示约定推导，预测逾期超 24 小时转入「晚于预计」。 */

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { j } from "../../api/client";
import type { CalendarData, CalendarEvent } from "../../api/types";
import { useLang } from "../../i18n/useLang";
import { safeUrl } from "../../utils/format";

/* 公告到生效的展示滞后：重置公告通常数小时内落地，取 6 小时作为「已生效」分界 */
const EFFECTIVE_MS = 6 * 3600e3;
/* 预测点逾期超过该阈值仍无新公告：从「应已生效」转入「晚于预计」 */
const OVERDUE_MS = 24 * 3600e3;
/* 单日格子最多展示的状态点数，溢出折叠为 +N */
const MAX_CELL_DOTS = 4;

const pad2 = (n: number) => String(n).padStart(2, "0");

/* 本地日键（YYYY-MM-DD）：月份网格与事件归组的统一口径 */
function dayKey(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/* 状态点：done=已生效 pending=待生效 due=应已生效 over=晚于预计 */
type DotState = "done" | "pending" | "due" | "over";

interface Cell {
  key: string;
  num: number;
  off: boolean; // 非当月（补位格）
}

/* 事件状态点：公告生效滞后 6 小时，未到即待生效 */
function eventDot(ev: CalendarEvent, now: number): DotState {
  return Date.parse(ev.created_at) + EFFECTIVE_MS <= now ? "done" : "pending";
}

export function CalendarSection({ tick }: { tick: number }) {
  const { t } = useTranslation();
  const lang = useLang();
  const locale = lang === "zh" ? "zh-CN" : "en-US";
  const now0 = new Date();
  const [ym, setYm] = useState({ y: now0.getFullYear(), m: now0.getMonth() + 1 });
  const [data, setData] = useState<CalendarData | null>(null);
  const [err, setErr] = useState("");
  const [sel, setSel] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let alive = true;
    j<CalendarData>(`/api/calendar?year=${ym.y}&month=${ym.m}`)
      .then((d) => {
        if (alive) {
          setData(d);
          setErr("");
        }
      })
      .catch((e) => {
        if (alive) setErr((e as Error).message);
      });
    return () => {
      alive = false;
    };
  }, [ym, tick]);

  /* 事件按本地日归组；日历数据带 ±2 天缓冲，网格渲染时按本地月裁剪。
     events 先按 data 记忆化：避免每次渲染的新数组引用让 byDay 的 useMemo 失效 */
  const events = useMemo(() => data?.events || [], [data]);
  const pred = data?.prediction || null;

  const byDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    events.forEach((ev) => {
      const k = dayKey(new Date(Date.parse(ev.created_at)));
      map.set(k, [...(map.get(k) || []), ev]);
    });
    return map;
  }, [events]);

  const predDay = pred ? dayKey(new Date(Date.parse(pred.expected_at))) : null;
  const predOverdue = pred ? now - Date.parse(pred.expected_at) > OVERDUE_MS : false;
  const predDue = pred ? now >= Date.parse(pred.expected_at) : false;

  /* 某日的状态点：真事件优先（有任一未生效即待生效），无事件时预测点补位 */
  function dayDot(key: string): DotState | null {
    const list = byDay.get(key);
    if (list?.length) return list.some((ev) => eventDot(ev, now) === "pending") ? "pending" : "done";
    if (key === predDay && !byDay.get(key)?.length) return predOverdue ? "over" : predDue ? "due" : "pending";
    return null;
  }

  /* 月份网格按实际周数补位，避免短月份凭空多占一行阅读空间。 */
  const cells = useMemo<Cell[]>(() => {
    const first = new Date(ym.y, ym.m - 1, 1);
    const startOffset = (first.getDay() + 6) % 7; // getDay 周日=0，换算周一开头
    const start = new Date(ym.y, ym.m - 1, 1 - startOffset);
    const out: Cell[] = [];
    const dayCount = new Date(ym.y, ym.m, 0).getDate();
    const cellCount = Math.ceil((startOffset + dayCount) / 7) * 7;
    for (let i = 0; i < cellCount; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      out.push({ key: dayKey(d), num: d.getDate(), off: d.getMonth() + 1 !== ym.m });
    }
    return out;
  }, [ym]);

  const todayKey = dayKey(new Date());
  const monthPrefix = `${ym.y}-${pad2(ym.m)}-`;

  /* 当月事件计数（本地口径）：标题下的「N 次额度重置 · M 次发重置卡」 */
  const monthEvents = events.filter((ev) => dayKey(new Date(Date.parse(ev.created_at))).startsWith(monthPrefix));
  const quotaN = monthEvents.filter((ev) => ev.kind === "quota").length;
  const cardN = monthEvents.length - quotaN;

  const fmtMonth = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(new Date(ym.y, ym.m - 1, 1));  const fmtDay = new Intl.DateTimeFormat(locale, { month: "long", day: "numeric" });
  const fmtShort = new Intl.DateTimeFormat(locale, {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const selEvents = sel ? byDay.get(sel) || [] : [];
  const selPred = sel != null && sel === predDay && !selEvents.length ? pred : null;
  const selDate = sel ? new Date(sel + "T00:00:00") : null;

  /* 翻月收起旧明细；用户点选日期后再展开，避免把旧日期带到新月份。 */
  const goMonth = (dy: number, dm: number) => {
    const nx = { y: dy, m: dm };
    setYm(nx);
    setSel(null);
  };

  return (
    <>
      <h2 className="sr-only">{t("calTitle")}</h2>
      <div className="cal-nav">
        <span className="cal-title">{fmtMonth}</span>
        <div className="cal-month-actions">
        <button
          className="cal-nav-btn"
          type="button"
          aria-label={t("calPrev")}
          onClick={() => (ym.m === 1 ? goMonth(ym.y - 1, 12) : goMonth(ym.y, ym.m - 1))}
        >
          ‹
        </button>
        <button
          className="cal-nav-btn"
          type="button"
          aria-label={t("calNext")}
          onClick={() => (ym.m === 12 ? goMonth(ym.y + 1, 1) : goMonth(ym.y, ym.m + 1))}
        >
          ›
        </button>
        </div>
      </div>
          <div className="cal-sub">
            <span>
              {t("calSummary", {
                quota: quotaN,
                card: cardN,
              })}
            </span>
            {pred && (
              <span className={"cal-pill " + (predOverdue ? "over" : "wait")} title={t("calPredBasis", { h: pred.avg_interval_hours })}>
                <span className="dot" aria-hidden />
                {t("calAvgNext", { h: pred.avg_interval_hours, time: fmtShort.format(new Date(Date.parse(pred.expected_at))) })}
              </span>
            )}
          </div>
          <div className="cal-grid" role="grid">
            {[1, 2, 3, 4, 5, 6, 7].map((i) => (
              <span key={i} className="cal-wd">
                {t(`calWd${i}`)}
              </span>
            ))}
            {cells.map((c) => {
              const list = byDay.get(c.key) || [];
              const dot = dayDot(c.key);
              const isPred = !list.length && c.key === predDay;
              return (
                <button
                  key={c.key}
                  type="button"
                  className={
                    "cal-cell" +
                    (c.off ? " off" : "") +
                    (c.key === todayKey ? " today" : "") +
                    (c.key === sel ? " sel" : "")
                  }
                  aria-label={t("calSelectDay", { day: c.key })}
                  aria-pressed={c.key === sel}
                  onClick={() => setSel((current) => current === c.key ? null : c.key)}
                >
                  <span className="cal-num">{c.num}</span>
                  {/* 状态点：实心=实际公告（颜色区分已生效/待生效），空心环=预测点 */}
                  <span className="cal-dots">
                    {list.slice(0, MAX_CELL_DOTS).map((ev) => (
                      <i key={ev.id} className={"cal-dot " + eventDot(ev, now)} />
                    ))}
                    {list.length > MAX_CELL_DOTS && <span className="cal-dot more">+{list.length - MAX_CELL_DOTS}</span>}
                    {isPred && dot && <i className={"cal-dot pred " + dot} />}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="cal-legend">
            <span>
              <i className="lg-dot done" /> {t("stDone")}
            </span>
            <span>
              <i className="lg-dot due" /> {t("stDue")}
            </span>
            <span>
              <i className="lg-dot pending" /> {t("stPending")}
            </span>
            <span>
              <i className="lg-dot over" /> {t("stOver")}
            </span>
            <span className="lg-hint">{t("calHollowHint")}</span>
          </div>
          {/* 点选日期才展开明细，首屏把空间留给通知渠道与数据源。 */}
          {sel && selDate && (
            <div className="cal-detail">
              <div className="cal-day-head">
                {fmtDay.format(selDate)}
                {sel === todayKey ? ` · ${t("calToday")}` : ""}
              </div>
              {err && <div className="cal-empty">{err}</div>}
              {!err && !selEvents.length && !selPred && <div className="cal-empty">{t("calEmptyDay")}</div>}
              {selEvents.map((ev) => {
                const st = eventDot(ev, now);
                return (
                  <div key={ev.id} className="cal-evcard">
                    <div className="ce-head">
                      <span className="ce-kind">{ev.kind === "card" ? t("evCard") : t("evQuota")}</span>
                      <span className={"ce-state " + st}>
                        <i className="lg-dot" /> {t(st === "done" ? "stDone" : "stPending")}
                      </span>
                    </div>
                    <div className="ce-time">
                      {t("calEffAt", {
                        time: fmtShort.format(new Date(Date.parse(ev.created_at) + EFFECTIVE_MS)),
                      })}
                    </div>
                    {/* 推文正文走 JSX 文本插值，React 自动转义等价于 esc()（esc 会造成双重转义） */}
                    <p className="ce-quote">“{ev.text}”</p>
                    <a className="ce-link" href={safeUrl(ev.url)} target="_blank" rel="noopener">
                      {t("viewOnX")} ↗
                    </a>
                  </div>
                );
              })}
              {selPred && (
                <div className="cal-evcard pred">
                  <div className="ce-head">
                    <span className="ce-kind">{t("evPred")}</span>
                    <span className={"ce-state " + (predOverdue ? "over" : predDue ? "due" : "pending")}>
                      <i className="lg-dot" /> {t(predOverdue ? "stOver" : predDue ? "stDue" : "stPending")}
                    </span>
                  </div>
                  <div className="ce-time">
                    {t("calExpAt", { time: fmtShort.format(new Date(Date.parse(selPred.expected_at))) })}
                  </div>
                  <p className="ce-quote">{t("calPredBasis", { h: selPred.avg_interval_hours })}</p>
                </div>
              )}
            </div>
          )}
    </>
  );
}
