/* 日历为主、帖子为辅；读取与操作沿用现有权限和刷新链路。 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { j } from "./api/client";
import type { Stats, Status, Tweet } from "./api/types";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { ThemeProvider } from "./context/ThemeContext";
import { ToastProvider } from "./context/ToastContext";
import { LangModeProvider } from "./i18n/LangModeContext";
import { Footer } from "./components/Footer";
import { Nav } from "./components/Nav";
import AnimatedContent from "./components/reactbits/AnimatedContent";
import { CalendarSection } from "./features/calendar/Calendar";
import { Feed } from "./features/feed/Feed";
import { RhythmCard } from "./features/sidebar/Sidebar";
import { TestNotifyButton } from "./components/TestNotifyButton";

function Panel() {
  const { t } = useTranslation();
  const auth = useAuth();
  const [history, setHistory] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [tweets, setTweets] = useState<Tweet[]>([]);
  const [hits, setHits] = useState<Tweet[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [calTick, setCalTick] = useState(0);
  const [calendarLoading, setCalendarLoading] = useState(true);

  const [ready, setReady] = useState({ tweets: false, hits: false, stats: false });
  const [errors, setErrors] = useState<string[]>([]);
  const [refreshing, setRefreshing] = useState(true);
  const requestRef = useRef<AbortController | null>(null);
  const { syncRequired } = auth;

  const refresh = useCallback(async (refreshCalendar = true) => {
    // 后发请求取代旧请求，避免慢响应覆盖刚完成的手动检查。
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setRefreshing(true);
    if (refreshCalendar) setCalTick((n) => n + 1);
    async function load<T,>(url: string, apply: (data: T) => void, key: string) {
      try {
        const data = await j<T>(url, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]) });
        if (!controller.signal.aborted) {
          apply(data);
          setErrors((old) => old.filter((item) => item !== key));
        }
      } catch {
        if (!controller.signal.aborted) setErrors((old) => old.includes(key) ? old : [...old, key]);
      } finally {
        if (!controller.signal.aborted && key !== "status") {
          setReady((old) => ({ ...old, [key]: true }));
        }
      }
    }
    // 各区收到数据即展示；一个接口失败不会丢弃其余成功结果。
    await Promise.all([
      load<Status>("/api/status", (st) => { setStatus(st); syncRequired(st.access_protected); }, "status"),
      load<Tweet[]>("/api/tweets?limit=10", setTweets, "tweets"),
      load<Tweet[]>("/api/hits?limit=10", setHits, "hits"),
      load<Stats>("/api/stats", setStats, "stats"),
    ]);
    if (!controller.signal.aborted) {
      setRefreshing(false);
      requestRef.current = null;
    }
  }, [syncRequired]);

  useEffect(() => {
    // 日历挂载时已自行请求，首轮不再触发第二次拉取。
    let alive = true;
    // StrictMode 预挂载结束后再发请求，避免同一首屏产生两套网络请求。
    queueMicrotask(() => { if (alive) void refresh(false); });
    const id = setInterval(() => {
      if (!document.hidden && !requestRef.current) void refresh();
    }, 60000);
    return () => { alive = false; clearInterval(id); requestRef.current?.abort(); };
  }, [refresh]);

  // 站点名称：页面标题与导航栏名称可经 MONITOR_SITE_NAME 配置
  useEffect(() => {
    if (status?.site_name) document.title = status.site_name;
  }, [status?.site_name]);

  return (
    <>
      <button className="skip-link" type="button" onClick={() => document.getElementById("panel-content")?.focus()}>{t("skipToContent")}</button>
      <Nav status={status} refreshing={refreshing || calendarLoading} onCheckDone={() => refresh()} />
      <main id="panel-content" className="wrap" tabIndex={-1}>
        {errors.length > 0 && <div className="panel-load-error" role="alert"><span>{t("panelPartialFail")}</span><button type="button" disabled={refreshing} onClick={() => void refresh()}>{t("postsRetry")}</button></div>}
        <CalendarSection tick={calTick} onLoadingChange={setCalendarLoading} />
        <section className="rhythm-section" aria-label={t("rhythmTitle")} aria-busy={!ready.stats}>
          {!ready.stats ? <div className="rhythm-skeleton" role="status" aria-label={t("monitorLoading")}><span className="skeleton sk-title" /><div className="rhythm-skeleton-grid">{[0,1,2].map((n) => <span key={n} className="skeleton sk-stat" />)}</div><span className="skeleton sk-heat" /></div>
            : stats ? <AnimatedContent distance={8} duration={0.35} initialOpacity={0.6}><RhythmCard stats={stats} /></AnimatedContent>
            : <p className="section-load-error">{t("rhythmLoadFail")}</p>}
        </section>
        <section className="posts-section" aria-label={t("feedView")}>
          <div className="feed-tabs" role="group" aria-label={t("feedView")}>
            <button type="button" aria-pressed={!history} onClick={() => setHistory(false)}>{t("recentPosts")}</button>
            <button type="button" aria-pressed={history} onClick={() => setHistory(true)}>{t("hitHistory")}</button>
          </div>
          <Feed key={history ? "history" : "recent"} tweets={history ? hits : tweets} mirror={status?.avatar_mirror} history={history} initialLoading={!ready[history ? "hits" : "tweets"]} initialFailed={errors.includes(history ? "hits" : "tweets")} onRetry={() => void refresh()} windowHours={auth.loggedIn ? status?.lookback_hours ?? 24 : Math.min(status?.lookback_hours ?? 24, 24)} />
        </section>
        {status?.debug && <div className="panel-utilities"><section className="card" aria-label={t("debugTitle")}><div className="card-core"><h2 className="sub-title">{t("debugTitle")}</h2>{status.demo && <p className="initial-note">{t("demoNotifyHint")}</p>}<TestNotifyButton /></div></section></div>}
        <Footer status={status} />
      </main>
    </>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <LangModeProvider>
          <AuthProvider>
            <Panel />
          </AuthProvider>
        </LangModeProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}
