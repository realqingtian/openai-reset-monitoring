/* 日历为主、帖子为辅；读取与操作沿用现有权限和刷新链路。 */

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { j } from "./api/client";
import type { Stats, Status, Tweet } from "./api/types";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { ThemeProvider } from "./context/ThemeContext";
import { ToastProvider, useToast } from "./context/ToastContext";
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
  const { toast } = useToast();
  const auth = useAuth();
  const [history, setHistory] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [tweets, setTweets] = useState<Tweet[]>([]);
  const [hits, setHits] = useState<Tweet[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  // 日历自取数据的刷新信号：面板每轮刷新（含手动立即检查）都会自增，日历跟随重取
  const [calTick, setCalTick] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const [st, tw, ht, stt] = await Promise.all([
        j<Status>("/api/status"),
        j<Tweet[]>("/api/tweets?limit=10"),
        j<Tweet[]>("/api/hits?limit=10"),
        j<Stats>("/api/stats"),
      ]);
      setStatus(st);
      setTweets(tw);
      setHits(ht);
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

  return (
    <>
      <button className="skip-link" type="button" onClick={() => document.getElementById("panel-content")?.focus()}>{t("skipToContent")}</button>
      <Nav status={status} onCheckDone={() => void refresh()} />
      <main id="panel-content" className="wrap" tabIndex={-1}>
        <CalendarSection tick={calTick} stats={stats} />
        <section className="posts-section" aria-label={t("feedView")}>
          <div className="feed-tabs" role="group" aria-label={t("feedView")}>
            <button type="button" aria-pressed={!history} onClick={() => setHistory(false)}>{t("recentPosts")}</button>
            <button type="button" aria-pressed={history} onClick={() => setHistory(true)}>{t("hitHistory")}</button>
          </div>
          <Feed key={history ? "history" : "recent"} tweets={history ? hits : tweets} mirror={status?.avatar_mirror} history={history} windowHours={auth.loggedIn ? status?.lookback_hours ?? 24 : Math.min(status?.lookback_hours ?? 24, 24)} />
        </section>
        <details className="rhythm-history">
          <summary>{t("viewRhythm")}</summary>
          <div className="rhythm-history-body"><AnimatedContent distance={8} duration={0.25}><RhythmCard stats={stats} /></AnimatedContent></div>
        </details>
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
