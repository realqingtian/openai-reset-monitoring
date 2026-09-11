/* 信息流渲染：时间轴帖子卡片、命中历史列表。 */
import { $, esc, safeUrl } from "./dom.js";
import { t } from "./i18n.js";
import { ago, fmt, fmtLocal, fmtUTC, hl, localOffsetLabel, localTZName } from "./format.js";
import { SVG_BOLT, SVG_LANG, SVG_LINK, SVG_RSS } from "./icons.js";
import { looksLike, restoreTranslations, targetLang } from "./translate.js";

const SOURCE_META = {
  rsshub: { label: "RSSHub", cls: "rss", icon: SVG_RSS },
  twitterapi_io: { label: "TwitterAPI.io", cls: "api", icon: SVG_BOLT },
  demo: { label: "Demo", cls: "demo", icon: SVG_BOLT },
};
function sourceChip(source) {
  const m = SOURCE_META[source] || { label: source, cls: "demo", icon: SVG_RSS };
  return `<span class="src-chip ${m.cls}">${m.icon}${esc(m.label)}</span>`;
}

const seenIds = new Set();
function tweetCard(tw, isNew, idx) {
  const pills = [sourceChip(tw.source)];
  if (tw.matched) {
    pills.push(`<span class="pill pill-hit">${esc(t("hitPill", { rule: tw.rule_name || "" }))}</span>`);
    (tw.matched_terms || []).slice(0, 6).forEach((w) => pills.push(`<span class="pill pill-term">${esc(w)}</span>`));
    if (tw.notified) pills.push(`<span class="pill">${t("pushed")}</span>`);
  }
  const cls = ["tentry", tw.matched ? "hit" : "", isNew ? "new" : ""].filter(Boolean).join(" ");
  const cardStyle = isNew ? ` style="animation-delay:${Math.min(idx * 70, 350)}ms"` : "";
  const canTrans = !looksLike(tw.text, targetLang());
  const actBtn = canTrans
    ? `<button class="entry-act" type="button" data-id="${esc(tw.id)}">${SVG_LANG}<span class="act-label">${esc(t("translate"))}</span></button>`
    : "";
  return `<article class="${cls}">
    <span class="tnode" aria-hidden="true"></span>
    <div class="tstamps">
      <span class="stamp-publish" title="${esc(t("pubTip"))}">${esc(t("stampPub", { t: fmtUTC(tw.created_at) }))}</span>
      <span class="stamp-local" title="${esc(t("localTip", { tz: localTZName, off: localOffsetLabel() }))}"><svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>${esc(t("stampLocal", { off: localOffsetLabel(), t: fmtLocal(tw.created_at) }))}</span>
      <span class="pill" title="${esc(t("agoTip"))}">${esc(t("stampAgo", { ago: ago(tw.created_at) }))}</span>
    </div>
    <div class="tcard"${cardStyle}>
      <div class="t-pills">${pills.join("")}</div>
      <p class="entry-text">${hl(tw.text, tw.matched_terms)}</p>
      <div class="entry-tr" data-tr="${esc(tw.id)}" hidden></div>
      <div class="entry-links">
        <a class="entry-link" href="${esc(safeUrl(tw.url))}" target="_blank" rel="noopener">${esc(t("viewOnX"))} ${SVG_LINK}</a>
        ${actBtn}
      </div>
    </div>
  </article>`;
}
/* 返回渲染结果并登记已见 ID：只有新出现的推文才播放入场动画 */
function renderTweetList(el, list) {
  const freshIdx = new Map();
  list.forEach((tw) => { if (!seenIds.has(tw.id)) freshIdx.set(tw.id, freshIdx.size); });
  el.innerHTML = list.length
    ? list.map((tw, i) => tweetCard(tw, freshIdx.has(tw.id), freshIdx.get(tw.id) || 0)).join("")
    : "";
  list.forEach((tw) => seenIds.add(tw.id));
  /* 面板每 60 秒整表重绘，把已取到的译文恢复回去，避免翻译状态丢失；手动收起的保持收起 */
  restoreTranslations(el);
}
function renderHitList(list) {
  const el = $("#hitList");
  if (!list.length) {
    el.innerHTML = `<div class="hempty">${t("hitEmpty")}</div>`;
    return;
  }
  el.innerHTML = list.map((tw) => `<a class="hrow" href="${esc(safeUrl(tw.url))}" target="_blank" rel="noopener" title="${esc(tw.created_at)}">
    <span class="h-time">${fmt(tw.created_at)}</span>
    <span class="h-text">${hl(tw.text, tw.matched_terms)}</span>
    <span class="pill pill-hit">${esc(t("hitShort"))}</span>
  </a>`).join("");
}

export { sourceChip, renderTweetList, renderHitList };
