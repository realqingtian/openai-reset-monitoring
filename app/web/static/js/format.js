/* 时间格式化（UTC/本地/相对时间）与命中词高亮。 */
import { esc, escRe } from "./dom.js";
import { lang } from "./i18n.js";

function hl(text, terms) {
  let html = esc(text);
  (terms || []).forEach((term) => {
    if (!term) return;
    // 纯 ASCII 词加 \b 边界，避免 "we" 高亮进 "weeks"；中文等无空格语言按子串匹配
    const body = escRe(esc(term));
    const pat = /^[A-Za-z0-9]/.test(term) && /[A-Za-z0-9]$/.test(term) ? `\\b${body}\\b` : body;
    try { html = html.replace(new RegExp(pat, "gi"), (m) => `<mark>${m}</mark>`); } catch (e) {}
  });
  return html;
}
function ago(iso) {
  if (!iso) return "—";
  let s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 0) s = 0;
  const zh = lang === "zh";
  if (s < 60) return zh ? "刚刚" : "just now";
  if (s < 3600) { const m = Math.floor(s / 60); return zh ? `${m} 分钟前` : `${m} min ago`; }
  if (s < 86400) { const h = Math.floor(s / 3600); return zh ? `${h} 小时前` : `${h}h ago`; }
  const d = Math.floor(s / 86400); return zh ? `${d} 天前` : `${d}d ago`;
}
/* 时间统一输出 年-月-日 时:分:秒，本地时间附时区偏移标注（推送文案同款 UTC/UTC+8 风格） */
function fmt(iso) {
  if (!iso) return "—";
  return `${fmtLocal(iso)} ${localOffsetLabel()}`;
}
/* 发布时间统一以 UTC 存储（真实发布时间），这里按 UTC 输出；加 8 小时即 X 上显示的北京时间 */
function fmtUTC(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}
function fmtLocal(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
function localOffsetLabel() {
  const off = -new Date().getTimezoneOffset() / 60;
  return "UTC" + (off >= 0 ? "+" : "") + off;
}
const localTZName = (() => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch (e) { return ""; }
})();

export { hl, ago, fmt, fmtUTC, fmtLocal, localOffsetLabel, localTZName };
