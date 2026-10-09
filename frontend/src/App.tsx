/* 公告阅读布局：帖子优先，节奏与日历作为旁栏上下文。
   保留同一套数据刷新与权限链路，避免视觉改版改变监控行为。 */

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { j } from "./api/client";
import type { Poll, Stats, Status, Tweet } from "./api/types";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { ThemeProvider } from "./context/ThemeContext";
import { ToastProvider, useToast } from "./context/ToastContext";
import { LangModeProvider } from "./i18n/LangModeContext";
import { Footer } from "./components/Footer";
import { Nav, type PanelView } from "./components/Nav";
import AnimatedContent from "./components/reactbits/AnimatedContent";
import { CalendarSection } from "./features/calendar/Calendar";
import { Feed, TweetCard } from "./features/feed/Feed";
import { HeatTile, MonitorIntro, NextResetCard, PulseCard, SourcesCol, SystemCard } from "./features/overview/Overview";

function Panel() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const auth = useAuth();
  const [view, setView] = useState<PanelView>("feed");
  const [history, setHistory] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [tweets, setTweets] = useState<Tweet[]>([]);
  const [hits, setHits] = useState<Tweet[]>([]);
  const [polls, setPolls] = useState<Poll[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  // 日历自取数据的刷新信号：面板每轮刷新（含手动立即检查）都会自增，日历跟随重取
  const [calTick, setCalTick] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const [st, tw, ht, pl, stt] = await Promise.all([
        j<Status>("/api/status"),
        j<Tweet[]>("/api/tweets"),
        j<Tweet[]>("/api/hits?limit=20"),
        j<Poll[]>("/api/polls?limit=200"),
        j<Stats>("/api/stats"),
      ]);
      setStatus(st);
      setTweets(tw);
      setHits(ht);
      setPolls(pl);
      setStats(stt);
      auth.syncRequired(st.access_protected);
    } catch (e) {
      toast(t("toastLoadFail", { e: (e as Error).message }), false);
    } finally {
      setCalTick((n) => n + 1);
    }
  }, [auth, t, toast]);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 60000);
    return () => clearInterval(id);
    // auth 对象随渲染重建，这里只挂载一次；syncRequired 是稳定的 setState 包装
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 站点名称：页面标题与导航栏名称可经 MONITOR_SITE_NAME 配置
  useEffect(() => {
    if (status?.site_name) document.title = status.site_name;
  }, [status?.site_name]);

  const featured = status?.latest_hit ?? hits[0] ?? null;

  return (
    <div className="editorial-panel">
      <Nav status={status} onCheckDone={() => void refresh()} view={view} onViewChange={setView} />
      <main className="wrap">
        <div className="reading-layout">
          <div className="reading-main">
            <MonitorIntro status={status} view={view} />
            <AnimatedContent distance={12} duration={0.4}>
              <section hidden={view !== "feed"} aria-label={t("navFeed")}>
                {featured ? (
                  <TweetCard key={featured.id} tw={featured} featured mirror={status?.avatar_mirror} />
                ) : (
                  <div className="featured-empty"><h2>{t("featuredEmptyTitle")}</h2><p>{t("hitEmpty")}</p></div>
                )}
                <div className="reading-tabs" role="group" aria-label={t("feedView")}>
                  <button type="button" aria-pressed={!history} onClick={() => setHistory(false)}>{t("recentPosts")}</button>
                  <button type="button" aria-pressed={history} onClick={() => setHistory(true)}>{t("hitHistory")}</button>
                  <span className="reading-count">{history ? hits.length : tweets.length}</span>
                </div>
                <Feed key={history ? "history" : "recent"} tweets={history ? hits : tweets} mirror={status?.avatar_mirror} history={history} />
              </section>
              <section hidden={view !== "rhythm"} aria-label={t("navRhythm")} className="rhythm-main">
                <HeatTile stats={stats} />
                <h2 className="section-heading">{t("hitHistory")}</h2>
                <Feed tweets={hits} mirror={status?.avatar_mirror} history />
              </section>
              <section hidden={view !== "system"} aria-label={t("sysTitle")} className="system-main">
                <SystemCard status={status} polls={polls} />
              </section>
            </AnimatedContent>
          </div>
          <aside className="reading-aside" aria-label={t("navRhythm")}>
            <NextResetCard status={status} stats={stats} />
            <section className="aside-calendar"><CalendarSection tick={calTick} /></section>
            <section className="aside-system"><SourcesCol status={status} /></section>
          </aside>
        </div>
        <PulseCard status={status} />
        <Footer status={status} />
      </main>
    </div>
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
