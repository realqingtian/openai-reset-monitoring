/* 应用装配：数据刷新主循环（60s 轮询 + 手动立即检查）、布局组装。
   布局为「倒计时优先」的 bento 网格：先回答核心问题（下次重置倒计时），再是证据区
   （26 周热力 + 重置日历）与信号区（帖子流，首屏可见），底部为运维区（历史命中 + 系统状态）。
   瓷片入场动画用 React Bits 的 AnimatedContent，实时统计数字用 CountUp。 */

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
import { CalendarSection } from "./features/calendar/Calendar";
import { Feed } from "./features/feed/Feed";
import { HeatTile, HitHistory, NextResetCard, PulseCard, SystemCard } from "./features/overview/Overview";

function Panel() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const auth = useAuth();
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
        {/* bento 网格：grid-template-areas 定义七个瓷片；帖子流（t-feed）保持首屏可见 */}
        <div className="dash">
          <AnimatedContent className="tile t-hero" distance={24} duration={0.6}>
            <NextResetCard status={status} stats={stats} />
          </AnimatedContent>
          <AnimatedContent className="tile t-pulse" distance={24} duration={0.6} delay={0.08}>
            <PulseCard status={status} />
          </AnimatedContent>
          <AnimatedContent className="tile t-heat" distance={24} duration={0.6} delay={0.12}>
            <HeatTile stats={stats} />
          </AnimatedContent>
          <AnimatedContent className="tile t-cal" distance={24} duration={0.6} delay={0.16}>
            <div className="card">
              <div className="card-core">
                <CalendarSection tick={calTick} />
              </div>
            </div>
          </AnimatedContent>
          <AnimatedContent className="tile t-feed" distance={24} duration={0.6} delay={0.1}>
            <Feed tweets={tweets} mirror={status?.avatar_mirror} />
          </AnimatedContent>
          <AnimatedContent className="tile t-hist" distance={24} duration={0.6} delay={0.2}>
            <HitHistory hits={hits} />
          </AnimatedContent>
          <AnimatedContent className="tile t-sys" distance={24} duration={0.6} delay={0.24}>
            <SystemCard status={status} polls={polls} />
          </AnimatedContent>
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
