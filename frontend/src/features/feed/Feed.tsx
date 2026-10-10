/* 公告与帖子共用安全渲染和翻译操作，避免主公告与列表出现行为差异。 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { ApiError, j } from "../../api/client";
import type { Tweet } from "../../api/types";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { AccountAvatar } from "../../components/AccountAvatar";
import { SVG_LANG, SVG_LINK } from "../../components/icons";
import { TipBubble } from "../../components/TipBubble";
import { useTipPos } from "../../hooks/useTipPos";
import { useLang } from "../../i18n/useLang";
import { fmtLocal, fmtUTC, ago as agoText, hl, localOffsetLabel, safeUrl } from "../../utils/format";

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

/* 正文与翻译操作共用：日历详情和帖子列表读取同一译文缓存与登录保护。 */
export function PostContent({ tw }: { tw: Pick<Tweet, "id" | "text" | "url" | "matched_terms"> }) {
  const { t } = useTranslation();
  const lang = useLang();
  const auth = useAuth();
  const { toast } = useToast();
  const [errHint, setErrHint] = useState("");
  const [openLang, setOpenLang] = useState<string | null>(null);
  const open = openLang === lang;
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

  return <div className="post-content">
          <p className="entry-text" dangerouslySetInnerHTML={{ __html: hl(tw.text, tw.matched_terms) }} />
          {open && tr && (
            <div className="entry-tr">
              {tr.loading && <span className="tr-meta">{t("translating")}</span>}
              {!tr.loading && tr.same && <span className="tr-meta">{t("trSame")}</span>}
              {!tr.loading && tr.error && <span className="tr-meta">{errHint || t("trFail")}</span>}
              {!tr.loading && tr.text && (
                <>
                  <div className="tr-heading"><span>{t("translatedText")}</span><span className="tr-meta">{tr.ai ? t("trTagAi", { p: tr.provider ?? "" }) : t("trTag", { p: tr.provider ?? "" })}</span></div>
                  <p className="tr-text">{tr.text}</p>
                </>
              )}
            </div>
          )}
          <div className="entry-footer">
            <div className="entry-links">
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
          </div>
  </div>;
}

export function TweetCard({ tw, mirror }: {
  tw: Tweet; isNew?: boolean; freshIdx?: number; mirror?: string | null; featured?: boolean;
}) {
  const { t } = useTranslation();
  const lang = useLang();
  const timeTip = useTipPos();
  return (
    <article className={"post-row tentry" + (tw.matched ? " hit" : "")}>
      <AccountAvatar handle={tw.account} name={tw.author_name} avatar={tw.author_avatar} mirror={mirror} size={40} />
      <div className="post-row-main">
        <div className="post-byline">
          <span className="tname">{tw.author_name || "@" + tw.account}</span>
          {tw.author_name && <span className="thandle">@{tw.account}</span>}
          <button type="button" className="post-age" {...timeTip.bind}>{agoText(tw.created_at, lang)}</button>
          <time className="post-date" dateTime={tw.created_at}>{fmtLocal(tw.created_at).slice(0, 16)}</time>
          {tw.is_reply && <span className="post-badge">{t("replyPill")}</span>}
          {tw.ai_verdict === "miss" && <span className="post-badge" title={t("aiMissTip", { reason: tw.ai_reason || "" })}>{t("aiMissPill")}</span>}
          {tw.notified && <span className="post-badge">{t("pushed")}</span>}
        </div>
        <TipBubble pos={timeTip.pos}>
          <div>UTC+0 {fmtUTC(tw.created_at)}</div>
          <div>{localOffsetLabel()} {fmtLocal(tw.created_at)}</div>
        </TipBubble>
        <PostContent tw={tw} />
      </div>
    </article>
  );
}

const PAGE_SIZE = 10;

function mergeTweets(...pages: Tweet[][]): Tweet[] {
  const unique = new Map<string, Tweet>();
  // 新页优先，避免旧缓存覆盖刷新后的命中与推送状态。
  pages.forEach((page) => page.forEach((tweet) => { if (!unique.has(tweet.id)) unique.set(tweet.id, tweet); }));
  return [...unique.values()].sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
}

export function Feed({ tweets, mirror, history = false, windowHours = 24 }: {
  tweets: Tweet[]; mirror?: string | null; history?: boolean; windowHours?: number; featuredId?: string;
}) {
  const { t } = useTranslation();
  const [items, setItems] = useState(() => tweets.slice(0, PAGE_SIZE));
  const [hasMore, setHasMore] = useState(tweets.length >= PAGE_SIZE);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(Date.now);
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
    // 两栏统一随页面滚动，接近页面中的列表底部时继续加载。
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void loadMore();
    }, { root: null, rootMargin: "0px 0px 80px 0px" });
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [failed, hasMore, loading, loadMore]);

  return (
    <div className="time-wrap feed-scroll" role="region" aria-label={t(history ? "hitHistory" : "recentPosts")}>
      <div className="tlist">
        {visibleTweets.length ? visibleTweets.map((tw) => <TweetCard key={tw.id} tw={tw} mirror={mirror} />) : <div className="empty">{t(history ? "hitEmpty" : "feedEmpty")}</div>}
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
