/* i18n：支持 zh / en，自动检测浏览器语言，不匹配默认英文。
   语言下拉交互在本模块内闭环；setLang 后续动作（如 refresh）经 onLangChange 由 main 装配。 */
import { $, $$ } from "./dom.js";
import { syncAllThumbs } from "./theme.js";

const I18N = {
  zh: {
    check: "立即检查", checking: "检查中…", testNotify: "发送测试通知",
    debugBtnTip: "仅在 MONITOR_ENV=debug 调试环境下可用",
    lightMode: "浅色模式", darkMode: "深色模式", systemMode: "跟随系统",
    followBrowser: "跟随浏览器语言",
    monitoring: "监控中", alertState: "已检测到重置公告",
    noHit: "最近 24 小时未检测到重置公告",
    hitDetected: "检测到重置公告 · 24 小时内 {n} 条",
    heroSub: "监控 {acc} · 最近检查 {ago} · 命中后自动推送全部已配置渠道",
    viewHit: "查看命中的推文",
    statTweets: "窗口内推文", statHits: "命中公告", statInterval: "轮询间隔",
    liveStats: "实时统计 · 24H", dataSources: "数据源", notifyChannels: "通知渠道",
    hitHistory: "历史命中", pollLog: "检查日志",
    pollLogTip: "每次自动检查都会记录在这里，最多展示最近 200 条，记录保留 30 天",
    langAutoMenu: "自动（跟随浏览器）", langAutoShort: "自动",
    secFeed: "最近 24 小时的帖子",
    srcDemo: "演示数据源", stNoKey: "缺凭证", stWait: "待首次检查",
    stOk: "正常 · {ago}", stFail: "失败 ×{n}",
    srcEmpty: "未启用任何数据源，请在 .env 中配置",
    ntReady: "就绪", notifHint: "命中时仅在面板展示，配置渠道后自动推送",
    feedEmpty: "窗口内暂无帖子，等待下次自动检查，或点击右上角“立即检查”。",
    hitEmpty: "暂无命中记录。命中“重置公告”的推文会出现在这里。",
    logEmpty: "暂无检查记录", logCount: "{n} 条",
    stampPub: "发布 UTC+0 {t}", stampLocal: "{off} {t}", stampAgo: "{ago}发布",
    pubTip: "帖子真实发布时间 · UTC+0 · 加 8 小时即北京时间（X 上显示的时间）", localTip: "发布时间换算到 {tz}（{off}）", agoTip: "距现在多久发布的 · 随每次刷新更新",
    hitPill: "命中 · {rule}", pushed: "已推送", hitShort: "命中",
    replyPill: "回复",
    viewOnX: "在 X 上查看",
    translate: "翻译", translating: "翻译中…", hideTrans: "收起译文",
    trTag: "机器译文 · {p}", trSame: "原文已是中文，无需翻译", trFail: "翻译失败，请稍后重试",
    okStat: "成功 · {n} 条 · {ms}", failStat: "失败",
    toastDone: "检查完成", toastCheckFail: "检查失败：{e}",
    toastNoChannel: "没有已启用且配置好的通知渠道（检查面板上的渠道状态）",
    toastSent: "测试消息已发送到 {n} 个渠道：{chs}",
    toastSendFail: "发送失败：{e}", toastLoadFail: "面板数据加载失败：{e}",
    prevPage: "上一页", nextPage: "下一页",
    footDesc: "持续监测 X 平台的 Codex 使用额度重置公告，命中后自动推送至全部已配置的通知渠道；数据每 {n} 分钟轮询更新，仅供个人运维参考。",
    footMeta: "© {year} {name} · 页面每 60 秒自动刷新",
  },
  en: {
    check: "Check now", checking: "Checking…", testNotify: "Send test notification",
    debugBtnTip: "Only available when MONITOR_ENV=debug",
    lightMode: "Light mode", darkMode: "Dark mode", systemMode: "Follow system",
    followBrowser: "Follow browser language",
    monitoring: "MONITORING", alertState: "ALERT · RESET DETECTED",
    noHit: "No reset announcement detected in the last 24 hours",
    hitDetected: "Reset announcement detected · {n} in 24h",
    heroSub: "Monitoring {acc} · last check {ago} · hits auto-push to all configured channels",
    viewHit: "View hit tweet",
    statTweets: "Tweets in window", statHits: "Hits", statInterval: "Poll interval",
    liveStats: "Live Stats · 24H", dataSources: "Data Sources", notifyChannels: "Notify Channels",
    hitHistory: "Hit History", pollLog: "Poll Log",
    pollLogTip: "Log of every automatic check — shows the latest 200 entries, kept for 30 days",
    langAutoMenu: "Auto (follow browser)", langAutoShort: "Auto",
    secFeed: "Posts in the last 24 hours",
    srcDemo: "Demo source", stNoKey: "No API key", stWait: "Pending first check",
    stOk: "OK · {ago}", stFail: "Failed ×{n}",
    srcEmpty: "No data source enabled. Configure one in .env",
    ntReady: "Ready", notifHint: "Hits show on the panel only. Configure a channel to get pushed.",
    feedEmpty: "No posts in the window yet. Waiting for the next check, or click \"Check now\".",
    hitEmpty: "No hits yet. Tweets matching the reset announcement will appear here.",
    logEmpty: "No check logs yet", logCount: "{n} entries",
    stampPub: "Published UTC+0 {t}", stampLocal: "{off} {t}", stampAgo: "posted {ago}",
    pubTip: "True post time · UTC+0 · +8h = Beijing time (as shown on X)", localTip: "Post time in {tz} ({off})", agoTip: "Elapsed time since publish · updates on each refresh",
    hitPill: "Hit · {rule}", pushed: "Pushed", hitShort: "Hit",
    replyPill: "Reply",
    viewOnX: "View on X",
    translate: "Translate", translating: "Translating…", hideTrans: "Hide translation",
    trTag: "Translation · {p}", trSame: "Already in English, no translation needed", trFail: "Translation failed, try again later",
    okStat: "OK · {n} tweets · {ms}", failStat: "Failed",
    toastDone: "Check finished", toastCheckFail: "Check failed: {e}",
    toastNoChannel: "No enabled & configured channel (check the channel status on the panel)",
    toastSent: "Test notification sent to {n} channel(s): {chs}",
    toastSendFail: "Send failed: {e}", toastLoadFail: "Failed to load panel data: {e}",
    prevPage: "Previous page", nextPage: "Next page",
    footDesc: "Continuous monitoring of Codex usage-reset announcements on X, with instant push to all configured channels. Data polls every {n} min; for personal ops reference only.",
    footMeta: "© {year} {name} · auto-refreshes every 60s",
  },
};
function detectLang() {
  const langs = [navigator.language, ...(navigator.languages || [])]
    .filter(Boolean).map((l) => l.toLowerCase());
  return langs.some((l) => l.startsWith("zh")) ? "zh" : "en";
}
const LANG_KEY = "crm-lang";
let langMode = (() => {
  try {
    const s = localStorage.getItem(LANG_KEY);
    if (s === "zh" || s === "en") return s;
  } catch (e) {}
  return "auto";
})();
let lang = "en";
function resolveLang() { return langMode === "auto" ? detectLang() : langMode; }
function t(key, params) {
  let s = (I18N[lang] && I18N[lang][key]) ?? I18N.en[key] ?? key;
  if (params) for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, v);
  return s;
}
function applyI18n() {
  lang = resolveLang();
  document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
  document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll("[data-i18n-title]").forEach((el) => {
    el.title = t(el.dataset.i18nTitle);
    el.setAttribute("aria-label", t(el.dataset.i18nTitle));
  });
  document.querySelectorAll("[data-i18n-tip]").forEach((el) => {
    el.dataset.tip = t(el.dataset.i18nTip);
    el.setAttribute("aria-label", t(el.dataset.i18nTip));
  });
  $("#pgPrev").setAttribute("aria-label", t("prevPage"));
  $("#pgNext").setAttribute("aria-label", t("nextPage"));
  $$(".drop-item").forEach((b) => b.classList.toggle("active", b.dataset.lang === langMode));
  syncDropTrigger();
  syncAllThumbs();
}
function syncDropTrigger() {
  const label = langMode === "zh" ? "中文" : langMode === "en" ? "English" : t("langAutoShort");
  $("#langLabel").textContent = label;
  $$(".drop-item").forEach((b) => b.classList.toggle("active", b.dataset.lang === langMode));
}

/* 语言变更监听：setLang 在 lang 就位后触发（main.js 注册 refresh 等） */
const langChange = [];
function onLangChange(fn) { langChange.push(fn); }

function setLang(mode) {
  langMode = mode;
  try { localStorage.setItem(LANG_KEY, mode); } catch (e) {}
  syncDropTrigger();
  if (!document.hidden && document.startViewTransition) document.startViewTransition(applyI18n);
  else applyI18n();
  // 同步更新 lang，消除“refresh 重绘早于语言切换回调”的竞态（applyI18n 幂等，稍后照常执行视觉过渡）
  lang = resolveLang();
  langChange.forEach((f) => f());
}
const langDrop = $("#langDrop");
$("#langTrigger").addEventListener("click", (e) => {
  e.stopPropagation();
  const open = langDrop.classList.toggle("open");
  langDrop.querySelector(".drop-trigger").setAttribute("aria-expanded", String(open));
});
document.addEventListener("click", (e) => { if (!langDrop.contains(e.target)) langDrop.classList.remove("open"); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") langDrop.classList.remove("open"); });
$$(".drop-item").forEach((b) => b.addEventListener("click", () => { setLang(b.dataset.lang); langDrop.classList.remove("open"); }));

export { langMode, lang, resolveLang, t, applyI18n, syncDropTrigger, setLang, onLangChange };
