/* 时间格式化（UTC/本地/相对时间）与命中词高亮。移植自旧面板 format.js / dom.js。
   hl() 返回 HTML 字符串（先整体转义再替换 <mark>），渲染用 dangerouslySetInnerHTML。 */

export type Lang = "zh" | "en";

export function esc(s: string | null | undefined): string {
  return (s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

function escRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/* 第三方数据里的链接只放行 http(s)；esc() 防不住 javascript: 伪协议 */
export function safeUrl(u: string | null | undefined): string {
  return /^https?:\/\//i.test(String(u || "")) ? String(u) : "#";
}

/* 头像原图 URL → 实际加载地址：配置镜像前缀时整体编码拼接（墙内经镜像代抓），未配置时直连 */
export function avatarSrc(avatar: string | null | undefined, mirror?: string | null): string {
  const raw = safeUrl(avatar || "");
  if (!raw) return "";
  const prefix = (mirror || "").trim();
  return prefix ? prefix + encodeURIComponent(raw) : raw;
}

export function hl(text: string | null | undefined, terms: string[] | null | undefined): string {
  let html = esc(text);
  (terms || []).forEach((term) => {
    if (!term) return;
    // 纯 ASCII 词加 \b 边界，避免 "we" 高亮进 "weeks"；中文等无空格语言按子串匹配
    const body = escRe(esc(term));
    const pat = /^[A-Za-z0-9]/.test(term) && /[A-Za-z0-9]$/.test(term) ? `\\b${body}\\b` : body;
    try {
      html = html.replace(new RegExp(pat, "gi"), (m) => `<mark>${m}</mark>`);
    } catch {
      /* 非法正则形状（理论上不会出现）：跳过该词 */
    }
  });
  return html;
}

export function ago(iso: string | null | undefined, lang: Lang): string {
  if (!iso) return "—";
  let s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 0) s = 0;
  const zh = lang === "zh";
  if (s < 60) return zh ? "刚刚" : "just now";
  if (s < 3600) {
    const m = Math.floor(s / 60);
    return zh ? `${m} 分钟前` : `${m} min ago`;
  }
  if (s < 86400) {
    const h = Math.floor(s / 3600);
    return zh ? `${h} 小时前` : `${h}h ago`;
  }
  const d = Math.floor(s / 86400);
  return zh ? `${d} 天前` : `${d}d ago`;
}

const pad = (n: number) => String(n).padStart(2, "0");

/* 发布时间统一以 UTC 存储（真实发布时间），按 UTC 输出；加 8 小时即 X 上显示的北京时间 */
export function fmtUTC(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

export function fmtLocal(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/* 时间统一输出 年-月-日 时:分:秒，本地时间附时区偏移标注（推送文案同款 UTC/UTC+8 风格） */
export function fmt(iso: string | null | undefined): string {
  if (!iso) return "—";
  const off = -new Date().getTimezoneOffset() / 60;
  return `${fmtLocal(iso)} UTC${off >= 0 ? "+" : ""}${off}`;
}

export function localOffsetLabel(): string {
  const off = -new Date().getTimezoneOffset() / 60;
  return "UTC" + (off >= 0 ? "+" : "") + off;
}

export const localTZName = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch {
    return "";
  }
})();
