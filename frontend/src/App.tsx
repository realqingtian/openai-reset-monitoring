/* 应用装配：数据刷新主循环（60s 轮询 + 手动立即检查）、布局组装。
   右栏卡片入场动画用 React Bits 的 AnimatedContent，实时统计数字用 CountUp。 */

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { j } from "./api/client";
import type { Poll, Stats, Status, Tweet } from "./api/types";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { ThemeProvider } from "./context/ThemeContext";
import { ToastProvider, useToast } from "./context/ToastContext";
import { LangModeProvider } from "./i18n/LangModeContext";
import { Footer } from "./components/Footer";
import { Nav } from "./components/Nav";
import AnimatedContent from "./components/reactbits/AnimatedContent";
import { Feed } from "./features/feed/Feed";
import { Hero } from "./features/hero/Hero";
import { HitHistory, LiveStats, PollLog, RhythmCard, Sources } from "./features/sidebar/Sidebar";

function Panel() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const auth = useAuth();
  const [status, setStatus] = useState<Status | null>(null);
  const [tweets, setTweets] = useState<Tweet[]>([]);
  const [hits, setHits] = useState<Tweet[]>([]);
  const [polls, setPolls] = useState<Poll[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);

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
      <div className="orbs" aria-hidden>
        <div className="orb orb-violet" />
        <div className="orb orb-emerald" />
        <div className="orb orb-blue" />
      </div>
      <div className="grain" aria-hidden />
      <Nav status={status} onCheckDone={() => void refresh()} />
      <div className="wrap">
        <div className="dash">
          <div className="main">
            <Hero status={status} />
            <Feed tweets={tweets} />
          </div>
          <aside className="rail">
            <div className="card">
              <div className="card-core">
                <AnimatedContent distance={24} duration={0.6}>
                  <LiveStats status={status} />
                  <div className="divider" />
                  <RhythmCard stats={stats} />
                  <Sources status={status} />
                </AnimatedContent>
              </div>
            </div>
            <div className="card">
              <div className="card-core">
                <AnimatedContent distance={24} duration={0.6} delay={0.1}>
                  <HitHistory hits={hits} />
                </AnimatedContent>
              </div>
            </div>
            <div className="card">
              <div className="card-core">
                <AnimatedContent distance={24} duration={0.6} delay={0.2}>
                  <PollLog polls={polls} />
                </AnimatedContent>
              </div>
            </div>
          </aside>
        </div>
        <Footer status={status} />
      </div>
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
