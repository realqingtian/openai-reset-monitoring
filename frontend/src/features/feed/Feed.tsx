/* 公告与帖子共用安全渲染和翻译操作，避免主公告与列表出现行为差异。 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { ApiError, j } from "../../api/client";
import type { Tweet } from "../../api/types";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { AccountAvatar } from "../../components/AccountAvatar";
import { SVG_BOLT, SVG_LANG, SVG_LINK, SVG_RSS } from "../../components/icons";
import { TipBubble } from "../../components/TipBubble";
import { useTipPos } from "../../hooks/useTipPos";
import { useLang } from "../../i18n/useLang";
import { esc, fmtLocal, fmtUTC, ago as agoText, hl, localOffsetLabel, safeUrl } from "../../utils/format";

const SOURCE_META: Record<string, { label: string; cls: string; icon: string }> = {
  rsshub: { label: "RSSHub", cls: "rss", icon: SVG_RSS },
  twitterapi_io: { label: "TwitterAPI.io", cls: "api", icon: SVG_BOLT },
  demo: { label: "Demo", cls: "demo", icon: SVG_BOLT },
};

/* 译文缓存（模块级）：60s 整表重绘不丢已取译文 */
interface Trans {
  loading: boolean;
  text?: string;
  provider?: string;
  ai?: boolean;
  same?: boolean;
  error?: boolean;
}
const transCache = new Map<string, Trans>();
const transListeners = new Set<() => void>();
function subscribeTranslation(listener: () => void) {
  transListeners.add(listener);
  return () => { transListeners.delete(listener); };
}
function setTranslation(key: string, value: Trans) {
  transCache.set(key, value);
  // 主公告与列表可能展示同一帖子，所有副本共享请求结果，但各自保留展开状态。
  transListeners.forEach((listener) => listener());
}

/* 目标语言判断：zh 目标时文本已含中文视为同语；en 目标时纯 Latin-1（含标点/换行）视为同语 */
function looksLike(text: string, lang: "zh" | "en"): boolean {
  if (lang === "zh") return /[\u4e00-\u9fff]/.test(text);
  return !text.split("").some((c) => c.charCodeAt(0) > 0xff);
}

export function TweetCard({ tw, isNew = false, freshIdx = 0, mirror, featured = false }: {
  tw: Tweet; isNew?: boolean; freshIdx?: number; mirror?: string | null; featured?: boolean;
}) {
  const { t } = useTranslation();
  const lang = useLang();
  const auth = useAuth();
  const { toast } = useToast();
  const [errHint, setErrHint] = useState("");
  const [openLang, setOpenLang] = useState<string | null>(null);
  const open = openLang === lang;
  const timeTip = useTipPos();
  const meta = SOURCE_META[tw.source] || { label: tw.source, cls: "demo", icon: SVG_RSS };
  // 缓存区分目标语言：切换界面语言后不能沿用另一种语言的译文。
  const cacheKey = `${lang}:${tw.id}`;
  const tr = useSyncExternalStore(subscribeTranslation, () => transCache.get(cacheKey));
  const canTrans = !looksLike(tw.text, lang);

  async function toggleTranslate() {
    if (open) {
      setOpenLang(null);
      return;
    }
    setOpenLang(lang);
    const cur = transCache.get(cacheKey);
    if (cur?.text || cur?.same || cur?.loading) return;
    setTranslation(cacheKey, { loading: true });
    const to = lang === "zh" ? "zh" : "en";
    try {
      // 与立即检查一致：401 时 guard 引导登录，登录成功自动重试。
      const data = await auth.guard(() =>
        j<{ text?: string; provider?: string; ai?: boolean; same?: boolean }>(
          `/api/translate?id=${encodeURIComponent(tw.id)}&to=${to}`,
        ),
      );
      setTranslation(cacheKey, { loading: false, text: data.text, provider: data.provider, ai: data.ai, same: data.same });
    } catch (e) {
      const authFail = e instanceof ApiError && e.auth;
      if (authFail) {
        setTranslation(cacheKey, { loading: false });
        setOpenLang(null);
        toast(t("toastNeedLogin"), false);
      } else {
        setTranslation(cacheKey, { loading: false, error: true });
        setErrHint(t("trFail"));
      }
    }
  }

  const pills = [
    <span key="src" className={`src-chip ${meta.cls}`}>
      <span dangerouslySetInnerHTML={{ __html: meta.icon }} />
      {tw.source === "demo" ? t("demoLabel") : meta.label}
    </span>,
  ];
  if (tw.is_reply) pills.push(<span key="reply" className="pill">{t("replyPill")}</span>);
  if (tw.matched) {
    pills.push(<span key="hit" className="pill pill-hit" title={t("hitPill", { rule: tw.rule_name || "" })}>{t("hitShort")}</span>);
    // AI 复核判定为无关：解释这条命中为什么没有被推送（悬停看 AI 的一句话依据）
    if (tw.ai_verdict === "miss") {
      pills.push(
        <span key="ai" className="pill pill-ai" title={esc(t("aiMissTip", { reason: tw.ai_reason || "" }))}>
          {t("aiMissPill")}
        </span>,
      );
    }
    if (tw.ai_verdict === "hit") pills.push(<span key="review" className="pill pill-review">{t("aiReviewed")}</span>);
    if (tw.notified) pills.push(<span key="pushed" className="pill pill-pushed">{t("pushed")}</span>);
  }

  return (
    <article
      className={["tentry", featured ? "featured-story" : "", tw.matched ? "hit" : "", isNew ? "new" : ""].filter(Boolean).join(" ")}
      style={isNew ? { animationDelay: `${Math.min(freshIdx * 70, 350)}ms` } : undefined}
    >
      {featured && (
        <>
          <div className="story-eyebrow">{t("latestMatch")} · {fmtLocal(tw.created_at).slice(5, 16)} {localOffsetLabel()}</div>
          <h2 className="story-title">{t(tw.ai_verdict === "miss" ? "featuredReviewMiss" : "featuredTitle")}</h2>
        </>
      )}
      <div className="tcard-core">
          {/* 第三方文本由 React 转义；正文仅通过 hl 生成安全高亮。 */}
          <div className="ta-head">
            <AccountAvatar handle={tw.account} name={tw.author_name} avatar={tw.author_avatar} mirror={mirror} />
            <div className="ta-who">
              {tw.author_name ? (
                <>
                  <span className="tname">{tw.author_name}</span>
                  <span className="thandle">@{tw.account}</span>
                </>
              ) : (
                <span className="tname">@{tw.account}</span>
              )}
            </div>
            {/* 相对时间为 X 式主显示；悬停气泡给完整双时区秒级（即时 portal，代替原生 title） */}
            <span className="t-time" {...timeTip.bind}>{agoText(tw.created_at, lang)}</span>
            <div className={"t-pills " + (featured ? "story-pills" : "row-pills")}>{pills}</div>
          </div>
          <TipBubble pos={timeTip.pos}>
            <div>UTC+0 {fmtUTC(tw.created_at)}</div>
            <div>{localOffsetLabel()} {fmtLocal(tw.created_at)}</div>
          </TipBubble>
          <p className="entry-text" dangerouslySetInnerHTML={{ __html: hl(tw.text, tw.matched_terms) }} />
          <div className="entry-links">
            {featured && <time className="story-time" dateTime={tw.created_at}>{fmtLocal(tw.created_at)} {localOffsetLabel()}</time>}
            <a className="entry-link" href={safeUrl(tw.url)} target="_blank" rel="noopener">
              {t("viewOnX")} <span dangerouslySetInnerHTML={{ __html: SVG_LINK }} />
            </a>
            {canTrans && (
              <button className="entry-act" type="button" aria-expanded={open} disabled={open && tr?.loading} onClick={() => void toggleTranslate()}>
                <span dangerouslySetInnerHTML={{ __html: SVG_LANG }} />
                <span className="act-label">{open && tr?.loading ? t("translating") : open ? t("hideTrans") : t("translate")}</span>
              </button>
            )}
          </div>
          {open && tr && (
            <div className="entry-tr">
              {tr.loading && <span className="tr-meta">{t("translating")}</span>}
              {!tr.loading && tr.same && <span className="tr-meta">{t("trSame")}</span>}
              {!tr.loading && tr.error && <span className="tr-meta">{errHint || t("trFail")}</span>}
              {!tr.loading && tr.text && (
                <>
                  <p className="tr-text">{tr.text}</p>
                  {/* AI 厂商译文单独标注，免费通道（google/mymemory）维持「机器译文」 */}
                  <span className="tr-meta">{tr.ai ? t("trTagAi", { p: tr.provider ?? "" }) : t("trTag", { p: tr.provider ?? "" })}</span>
                </>
              )}
            </div>
          )}
      </div>
    </article>
  );
}

/* 已见推文集合（模块级）：首屏不播整列入场动画，之后新出现的推文按序播放入场（旧面板同款）。
   哨兵 SEEN_FIRST 标记首屏已发生，避免模块级布尔量的重赋值。 */
const seenIds = new Set<string>();
const SEEN_FIRST = "__first_render__";

const PAGE_SIZE = 10;

function mergeTweets(...pages: Tweet[][]): Tweet[] {
  const unique = new Map<string, Tweet>();
  // 新页优先，避免旧缓存覆盖刷新后的命中与推送状态。
  pages.forEach((page) => page.forEach((tweet) => { if (!unique.has(tweet.id)) unique.set(tweet.id, tweet); }));
  return [...unique.values()].sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
}

export function Feed({ tweets, mirror, history = false, windowHours = 24 }: {
  tweets: Tweet[]; mirror?: string | null; history?: boolean; windowHours?: number;
}) {
  const { t } = useTranslation();
  const [items, setItems] = useState(() => tweets.slice(0, PAGE_SIZE));
  const [hasMore, setHasMore] = useState(tweets.length >= PAGE_SIZE);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(Date.now);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const loadedOlder = useRef(false);
  const requestRef = useRef<AbortController | null>(null);
  const previousWindow = useRef(windowHours);

  useEffect(() => {
    const changedWindow = previousWindow.current !== windowHours;
    previousWindow.current = windowHours;
    if (changedWindow) {
      requestRef.current?.abort();
      requestRef.current = null;
      loadedOlder.current = false;
      setLoading(false);
      setFailed(false);
    }
    const head = tweets.slice(0, PAGE_SIZE);
    setItems((old) => loadedOlder.current ? mergeTweets(head, old) : head);
    if (!loadedOlder.current) setHasMore(head.length === PAGE_SIZE);
  }, [tweets, windowHours]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => { clearInterval(timer); requestRef.current?.abort(); };
  }, []);

  // 时间窗口缩小（例如退出登录）时立即隐藏窗口外缓存，避免旧页继续展示。
  const cutoff = now - windowHours * 3600e3;
  const visibleTweets = history ? items : items.filter((tweet) => Date.parse(tweet.created_at) >= cutoff);

  const loadMore = useCallback(async () => {
    const last = items[items.length - 1];
    if (!hasMore || !last || requestRef.current) return;
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    setFailed(false);
    const query = new URLSearchParams({ limit: String(PAGE_SIZE), before: last.id });
    if (!history) query.set("hours", String(windowHours));
    try {
      const rows = await j<Tweet[]>(`/api/${history ? "hits" : "tweets"}?${query}`, { signal: controller.signal });
      if (controller.signal.aborted) return;
      loadedOlder.current = true;
      setItems((old) => mergeTweets(old, rows));
      setHasMore(rows.length === PAGE_SIZE);
    } catch {
      if (!controller.signal.aborted) setFailed(true);
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
        setLoading(false);
      }
    }
  }, [hasMore, history, items, windowHours]);

  useEffect(() => {
    if (!hasMore || loading || failed || !sentinelRef.current) return;
    const media = matchMedia("(max-width: 820px)");
    let observer: IntersectionObserver;
    const observe = () => {
      observer?.disconnect();
      observer = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void loadMore();
      }, { root: media.matches ? null : scrollRef.current, rootMargin: "0px 0px 80px 0px" });
      if (sentinelRef.current) observer.observe(sentinelRef.current);
    };
    observe();
    media.addEventListener("change", observe);
    return () => { observer.disconnect(); media.removeEventListener("change", observe); };
  }, [failed, hasMore, loading, loadMore]);

  const isFirstRender = !seenIds.has(SEEN_FIRST);
  const freshIds = isFirstRender ? new Set<string>() : new Set(visibleTweets.filter((tw) => !seenIds.has(tw.id)).map((tw) => tw.id));
  seenIds.add(SEEN_FIRST);
  visibleTweets.forEach((tw) => seenIds.add(tw.id));

  return (
    <div className="time-wrap feed-scroll" ref={scrollRef} tabIndex={0} role="region" aria-label={t(history ? "hitHistory" : "recentPosts")}>
      <div className="tlist">
        {visibleTweets.length ? visibleTweets.map((tw, index) => (
          <TweetCard key={tw.id} tw={tw} isNew={freshIds.has(tw.id)} freshIdx={index} mirror={mirror} />
        )) : <div className="empty">{t(history ? "hitEmpty" : "feedEmpty")}</div>}
      </div>
      {visibleTweets.length > 0 && (
        <div className="feed-pagination">
          <span className="feed-page-status" role="status">{t("postsLoaded", { n: visibleTweets.length })}</span>
          {failed && <span className="feed-page-error" role="alert">{t("postsLoadFail")}</span>}
          {hasMore ? (
            <button className="feed-more" type="button" disabled={loading} onClick={() => void loadMore()}>
              {t(loading ? "postsLoading" : failed ? "postsRetry" : "postsLoadMore")}
            </button>
          ) : <span className="feed-page-end">{t("postsEnd")}</span>}
          <div className="feed-sentinel" ref={sentinelRef} aria-hidden />
        </div>
      )}
    </div>
  );
}
