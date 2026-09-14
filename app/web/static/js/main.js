/* 应用装配：数据刷新主循环、顶部动作按钮、系统偏好跨模块联动与启动时序。
   各功能模块（i18n/theme/translate/panel/feed）各自管理自己的 DOM 块与事件，
   本文件只负责把它们组合起来。 */
import { $, esc, reveal, scheduleSettle, toast } from "./dom.js";
import { j } from "./api.js";
import { applyI18n, lang, langMode, onLangChange, t } from "./i18n.js";
import { applyTheme, mqLight, syncFavicon, themeMode } from "./theme.js";
import { renderHitList, renderTweetList } from "./feed.js";
import { renderHero, renderPolls, renderRhythm, renderSources, setAllPolls } from "./panel.js";
import { requireUnlock, setProtected } from "./auth.js";

/* 写接口 401 时弹解锁窗，保存令牌后自动重试一次；取消则原样抛出（.auth 标记仍在） */
async function withAuthRetry(fn) {
  try {
    return await fn();
  } catch (e) {
    if (!e.auth) throw e;
    const unlocked = await requireUnlock();
    if (!unlocked) throw e;
    return await fn();
  }
}

async function refresh() {
  try {
    const [st, tweets, hits, polls, rhythm] = await Promise.all([
      j("/api/status"), j("/api/tweets"), j("/api/hits?limit=20"), j("/api/polls?limit=200"), j("/api/stats"),
    ]);
    renderHero(st);
    renderSources(st);
    renderRhythm(rhythm);
    setProtected(st.access_protected);

    if (tweets.length) renderTweetList($("#tweetList"), tweets);
    else $("#tweetList").innerHTML = `<div class="empty">${t("feedEmpty")}</div>`;
    renderHitList(hits);

    setAllPolls(polls);
    renderPolls();

    $("#foot").innerHTML =
      `<div class="foot-desc">${esc(t("footDesc", { n: st.poll_interval_minutes }))}</div>` +
      `<div class="foot-meta"><span>${esc(t("footMeta", { year: new Date().getFullYear(), name: st.site_name || "Reset Monitor" }))}</span></div>`;

    reveal(document);
    scheduleSettle();
  } catch (e) {
    toast(t("toastLoadFail", { e: e.message }), false);
  }
}

$("#btnPoll").addEventListener("click", async (ev) => {
  const btn = ev.currentTarget;
  btn.disabled = true; btn.classList.add("loading");
  btn.dataset.label = btn.children[0].textContent;
  btn.children[0].textContent = t("checking");
  try {
    await withAuthRetry(() => j("/api/poll-now", { method: "POST" }));
    await refresh();
    toast(t("toastDone"));
  } catch (e) {
    toast(e.auth ? t("toastNeedToken") : t("toastCheckFail", { e: e.message }), false);
  } finally {
    btn.disabled = false; btn.classList.remove("loading");
    btn.children[0].textContent = t("check");
  }
});

$("#btnNotify").addEventListener("click", async (ev) => {
  const btn = ev.currentTarget;
  btn.disabled = true;
  try {
    const results = await withAuthRetry(() => j("/api/test-notify", { method: "POST" }));
    if (!results.length) { toast(t("toastNoChannel"), false); }
    else {
      const fails = results.filter((r) => !r.ok);
      const chs = results.map((r) => r.channel).join(lang === "zh" ? "、" : ", ");
      toast(fails.length
        ? t("toastSendFail", { e: fails.map((f) => f.channel).join(", ") + (fails[0].error ? " " + fails[0].error : "") })
        : t("toastSent", { n: results.length, chs }),
        !fails.length);
    }
  } catch (e) {
    toast(e.auth ? t("toastNeedToken") : t("toastSendFail", { e: e.message }), false);
  } finally {
    btn.disabled = false;
  }
});

/* 系统深浅色切换时的跨模块联动：auto 语言重解析、system 主题跟随、favicon 同步 */
mqLight.addEventListener?.("change", () => { if (langMode === "auto") applyI18n(); if (themeMode === "system") applyTheme(); syncFavicon(); });
/* 语言切换后重拉数据，让动态渲染的文案（卡片/hero/日志）立即用新语言 */
onLangChange(refresh);

applyI18n();
applyTheme();
refresh();
setInterval(refresh, 60000);
