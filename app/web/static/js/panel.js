/* 侧栏与横幅渲染：hero 状态、重置节奏、数据源/通知渠道、检查日志分页。 */
import { $, animateNumber, esc, replay, safeUrl } from "./dom.js";
import { lang, t } from "./i18n.js";
import { ago, fmt, fmtLocal } from "./format.js";
import { SVG_ALERT, SVG_OK } from "./icons.js";

function renderHero(st) {
  // 站点名称：页面标题与导航栏名称可经 MONITOR_SITE_NAME 配置
  if (st.site_name) {
    document.title = st.site_name;
    document.querySelector(".brand-name").textContent = st.site_name;
  }
  const hit = st.hit_count_24h > 0;
  const changed = $("#hero").classList.contains("hit") !== hit;
  $("#hero").classList.toggle("hit", hit);
  $("#heroGlyph").innerHTML = hit ? SVG_ALERT : SVG_OK;
  if (changed) { replay($("#heroTitle"), "swap-in"); replay($("#heroGlyph"), "swap-in"); }
  $("#heroState").textContent = hit ? t("alertState") : t("monitoring");
  $("#heroDot").className = "pulse-dot " + (hit ? "red" : "green");
  $("#brandDot").className = "pulse-dot " + (hit ? "red" : "green");
  $("#heroTitle").textContent = hit ? t("hitDetected", { n: st.hit_count_24h }) : t("noHit");
  $("#heroSub").textContent = t("heroSub", {
    acc: st.accounts.map((a) => "@" + a).join(lang === "zh" ? "、" : ", "),
    ago: ago(st.last_poll_at),
  });
  const link = $("#heroLink");
  if (hit && st.latest_hit) { link.href = safeUrl(st.latest_hit.url); link.hidden = false; }
  else { link.hidden = true; }
  $("#demoBadge").hidden = !st.demo;
  // 调试模式下才显示"发送测试通知"；生产环境（debug 非 true）保持隐藏
  $("#btnNotify").hidden = st.debug !== true;
  animateNumber($("#statTweets"), st.tweets_24h);
  animateNumber($("#statHits"), st.hit_count_24h);
  $("#statHits").classList.toggle("alert", hit);
  $("#statInterval").textContent = st.poll_interval_minutes + " min";
}

/* ---- 重置节奏卡：平均间隔 / 上次命中 / 预期窗口 + 迷你时间线 ---- */

function fmtHours(h) {
  const zh = lang === "zh";
  if (h >= 48) return zh ? (h / 24).toFixed(1) + " 天" : (h / 24).toFixed(1) + " d";
  return zh ? Math.round(h) + " 小时" : Math.round(h) + " h";
}

function rhythmSpark(times) {
  // 迷你时间线：每个命中一根竖条，x 按时间比例分布；样本不足 2 个画不出间隔，直接省略
  if (!times || times.length < 2) return "";
  const t0 = new Date(times[0]).getTime();
  const tN = new Date(times[times.length - 1]).getTime();
  const span = Math.max(1, tN - t0);
  const bars = times.map((ts, i) => {
    const x = (2 + ((new Date(ts).getTime() - t0) / span) * 96).toFixed(1);
    const last = i === times.length - 1;
    const h = last ? 12 : 8;
    return `<rect x="${x}" y="${24 - h}" width="2.4" height="${h}" rx="1.2" class="${last ? "spk-last" : ""}"><title>${esc(fmt(ts))}</title></rect>`;
  });
  return `<svg class="rhythm-spark" viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true">` +
    `<line class="spk-base" x1="0" y1="25.5" x2="100" y2="25.5"/>${bars.join("")}</svg>`;
}

function renderRhythm(st) {
  const el = $("#rhythmBody");
  if (!st || !st.total_hits) {
    el.innerHTML = `<div class="hempty">${t("rhythmEmpty")}</div>`;
    return;
  }
  const rows = [
    [t("rhythmLast"), ago(st.last_hit_at), st.last_hit_at || ""],
    [t("rhythmAvg"), st.avg_interval_hours != null ? fmtHours(st.avg_interval_hours) : "—", t("rhythmAvgTip")],
    [t("rhythmHits30"), String(st.hits_30d), t("rhythmTotal", { n: st.total_hits })],
  ];
  let html = `<div class="rhythm-rows">` + rows.map(([k, v, tip]) =>
    `<div class="r-row"${tip ? ` title="${esc(tip)}"` : ""}><span class="r-key">${esc(k)}</span><span class="r-val">${esc(v)}</span></div>`
  ).join("") + `</div>`;
  if (st.next_expected_at) {
    html += `<div class="rhythm-next" title="${esc(t("rhythmNextTip"))}">` +
      `<span class="r-key">${esc(t("rhythmNext"))}</span> ${esc(fmtLocal(st.next_expected_at))}</div>`;
  } else {
    html += `<div class="rhythm-next"><span class="r-key">${esc(t("rhythmNoForecast"))}</span></div>`;
  }
  html += rhythmSpark(st.recent_hits);
  el.innerHTML = html;
}

function renderSources(st) {
  const rows = [];
  if (st.demo) rows.push(`<div class="srow"><span class="dot ok"></span><span class="sname">demo</span><span class="sstate">${t("srcDemo")}</span></div>`);
  // 只展示已启用的数据源，未启用的不出现在面板上
  st.sources.filter((s) => s.enabled).forEach((s) => {
    let cls, label;
    if (!s.configured) { cls = "warn"; label = t("stNoKey"); }
    else if (!s.known) { cls = "warn"; label = t("stWait"); }
    else if (s.healthy) { cls = "ok"; label = t("stOk", { ago: ago(s.last_ok) }); }
    else { cls = "bad"; label = t("stFail", { n: s.failures }); }
    rows.push(`<div class="srow" ${s.last_error ? `title="${esc(s.last_error)}"` : ""}><span class="dot ${cls}"></span><span class="sname">${esc(s.name)}</span><span class="sstate">${label}</span></div>`);
  });
  $("#srcRows").innerHTML = rows.join("") || `<div class="srow"><span class="dot warn"></span><span class="sname">—</span><span class="sstate">${t("srcEmpty")}</span></div>`;

  const ntf = [];
  let okCount = 0;
  // 只展示已启用的通知渠道
  st.notifiers.filter((n) => n.enabled).forEach((n) => {
    const cls = n.configured ? "ok" : "warn";
    const label = n.configured ? t("ntReady") : t("stNoKey");
    if (n.configured) okCount++;
    ntf.push(`<span class="npill"><span class="dot ${cls}"></span>${esc(n.name)} · ${label}</span>`);
  });
  if (okCount === 0) ntf.push(`<span class="npill">${t("notifHint")}</span>`);
  $("#ntfRows").innerHTML = ntf.join("");
}

let allPolls = [];
let pollPage = 1;
const POLL_PAGE_SIZE = 10;

function renderPolls() {
  const total = allPolls.length;
  const pages = Math.max(1, Math.ceil(total / POLL_PAGE_SIZE));
  pollPage = Math.min(Math.max(1, pollPage), pages);
  const start = (pollPage - 1) * POLL_PAGE_SIZE;
  $("#pollList").innerHTML = total
    ? allPolls.slice(start, start + POLL_PAGE_SIZE).map((p) => `
      <div class="logrow" title="${esc(p.error || "")}">
        <span class="log-time">${fmt(p.ts)}</span>
        <span class="dot ${p.ok ? "ok" : "bad"}"></span>
        <span class="log-src">${esc(p.source)}</span>
        <span class="log-stat">${p.ok
          ? t("okStat", { n: p.new_tweets ?? 0, ms: p.latency_ms != null ? p.latency_ms + "ms" : "—" })
          : t("failStat")}</span>
      </div>`).join("")
    : `<div class="hempty">${t("logEmpty")}</div>`;
  $("#pgInfo").textContent = `${pollPage} / ${pages}`;
  $("#logCount").textContent = t("logCount", { n: total });
  $("#pgPrev").disabled = pollPage <= 1;
  $("#pgNext").disabled = pollPage >= pages;
}

$("#pgPrev").addEventListener("click", () => { pollPage = Math.max(1, pollPage - 1); renderPolls(); });
$("#pgNext").addEventListener("click", () => { pollPage += 1; renderPolls(); });

/* refresh（main.js）轮询到新日志后的写入口 */
function setAllPolls(list) { allPolls = list; }

export { renderHero, renderRhythm, renderSources, renderPolls, setAllPolls };
