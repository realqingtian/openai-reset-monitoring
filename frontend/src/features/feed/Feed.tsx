/* 信息流：24h 帖子卡片（来源徽标、命中高亮、头部行时间、按需翻译）。 */

import { useState } from "react";
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
  open: boolean;
  loading: boolean;
  text?: string;
  provider?: string;
  same?: boolean;
  error?: boolean;
}
const transCache = new Map<string, Trans>();

/* 目标语言判断：zh 目标时文本已含中文视为同语；en 目标时纯 Latin-1（含标点/换行）视为同语 */
function looksLike(text: string, lang: "zh" | "en"): boolean {
  if (lang === "zh") return /[\u4e00-\u9fff]/.test(text);
  return !text.split("").some((c) => c.charCodeAt(0) > 0xff);
}

function TweetCard({ tw, isNew, freshIdx }: { tw: Tweet; isNew: boolean; freshIdx: number }) {
  const { t } = useTranslation();
  const lang = useLang();
  const auth = useAuth();
  const { toast } = useToast();
  const [, setTick] = useState(0);
  const [errHint, setErrHint] = useState("");
  const timeTip = useTipPos();
  const meta = SOURCE_META[tw.source] || { label: tw.source, cls: "demo", icon: SVG_RSS };
  const tr = transCache.get(tw.id);
  const canTrans = !looksLike(tw.text, lang);

  async function toggleTranslate() {
    const cur = transCache.get(tw.id);
    if (cur?.open) {
      transCache.set(tw.id, { ...cur, open: false });
    } else if (cur?.text || cur?.same) {
      transCache.set(tw.id, { ...cur, open: true });
    } else {
      transCache.set(tw.id, { open: true, loading: true });
      setTick((n) => n + 1);
      const to = lang === "zh" ? "zh" : "en";
      try {
        // 与立即检查一致：401 时 guard 引导登录，登录成功自动重试
        const data = await auth.guard(() =>
          j<{ text?: string; provider?: string; same?: boolean }>(
            `/api/translate?id=${encodeURIComponent(tw.id)}&to=${to}`,
          ),
        );
        transCache.set(tw.id, { open: true, loading: false, text: data.text, provider: data.provider, same: data.same });
      } catch (e) {
        const authFail = e instanceof ApiError && e.auth;
        if (authFail) {
          // 用户取消登录或重试仍被拒：收起译文块并提示，不误报「翻译失败」
          transCache.set(tw.id, { open: false, loading: false });
          toast(t("toastNeedLogin"), false);
        } else {
          transCache.set(tw.id, { open: true, loading: false, error: true });
          setErrHint(t("trFail"));
        }
      }
    }
    setTick((n) => n + 1);
  }

  const pills = [
    <span key="src" className={`src-chip ${meta.cls}`}>
      <span dangerouslySetInnerHTML={{ __html: meta.icon }} />
      {esc(meta.label)}
    </span>,
  ];
  if (tw.is_reply) pills.push(<span key="reply" className="pill">{t("replyPill")}</span>);
  if (tw.matched) {
    pills.push(<span key="hit" className="pill pill-hit">{esc(t("hitPill", { rule: tw.rule_name || "" }))}</span>);
    (tw.matched_terms || []).slice(0, 6).forEach((w, i) =>
      pills.push(<span key={`term${i}`} className="pill pill-term">{esc(w)}</span>),
    );
    if (tw.notified) pills.push(<span key="pushed" className="pill">{t("pushed")}</span>);
  }

  return (
    <article
      className={["tentry", tw.matched ? "hit" : "", isNew ? "new" : ""].filter(Boolean).join(" ")}
      style={isNew ? { animationDelay: `${Math.min(freshIdx * 70, 350)}ms` } : undefined}
    >
      <span className="tnode" aria-hidden />
      {/* 双层嵌框卡：与 Hero/侧栏卡片同款（.card shell + .card-core），.tcard/.tcard-core 只做信息流的尺寸与状态微调 */}
      <div className="card tcard">
        <div className="card-core tcard-core">
          {/* 头部行（方案A）：头像 + 昵称 + @handle + 右侧相对时间；第三方数据用 JSX 文本插值，React 自动转义等价于 esc() */}
          <div className="ta-head">
            <AccountAvatar handle={tw.account} name={tw.author_name} avatar={tw.author_avatar} />
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
          </div>
          <TipBubble pos={timeTip.pos}>
            <div>UTC+0 {fmtUTC(tw.created_at)}</div>
            <div>{localOffsetLabel()} {fmtLocal(tw.created_at)}</div>
          </TipBubble>
          <div className="t-pills">{pills}</div>
          <p className="entry-text" dangerouslySetInnerHTML={{ __html: hl(tw.text, tw.matched_terms) }} />
          {tr?.open && (
            <div className="entry-tr">
              {tr.loading && <span className="tr-meta">{t("translating")}</span>}
              {!tr.loading && tr.same && <span className="tr-meta">{t("trSame")}</span>}
              {!tr.loading && tr.error && <span className="tr-meta">{errHint || t("trFail")}</span>}
              {!tr.loading && tr.text && (
                <>
                  <p className="tr-text">{tr.text}</p>
                  <span className="tr-meta">{t("trTag", { p: tr.provider ?? "" })}</span>
                </>
              )}
            </div>
          )}
          <div className="entry-links">
            <a className="entry-link" href={safeUrl(tw.url)} target="_blank" rel="noopener">
              {t("viewOnX")} <span dangerouslySetInnerHTML={{ __html: SVG_LINK }} />
            </a>
            {canTrans && (
              <button className="entry-act" type="button" onClick={() => void toggleTranslate()}>
                <span dangerouslySetInnerHTML={{ __html: SVG_LANG }} />
                <span className="act-label">{tr?.open ? t("hideTrans") : t("translate")}</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}

/* 已见推文集合（模块级）：首屏不播整列入场动画，之后新出现的推文按序播放入场（旧面板同款）。
   哨兵 SEEN_FIRST 标记首屏已发生，避免模块级布尔量的重赋值。 */
const seenIds = new Set<string>();
const SEEN_FIRST = "__first_render__";

export function Feed({ tweets }: { tweets: Tweet[] }) {
  const { t } = useTranslation();
  const isFirstRender = !seenIds.has(SEEN_FIRST);
  const freshIds = isFirstRender
    ? new Set<string>()
    : new Set(tweets.filter((tw) => !seenIds.has(tw.id)).map((tw) => tw.id));
  seenIds.add(SEEN_FIRST);
  tweets.forEach((tw) => seenIds.add(tw.id));
  const freshIdx = new Map<string, number>();
  let i = 0;
  tweets.forEach((tw) => {
    if (freshIds.has(tw.id)) freshIdx.set(tw.id, i++);
  });

  return (
    <>
      <div className="sec-head in">
        <h2 className="sec-title">{t("secFeed")}</h2>
      </div>
      <div className="time-wrap">
        <div id="tweetList" className="tlist">
          {tweets.length ? (
            tweets.map((tw) => (
              <TweetCard key={tw.id} tw={tw} isNew={freshIds.has(tw.id)} freshIdx={freshIdx.get(tw.id) ?? 0} />
            ))
          ) : (
            <div className="empty">{t("feedEmpty")}</div>
          )}
        </div>
      </div>
    </>
  );
}
