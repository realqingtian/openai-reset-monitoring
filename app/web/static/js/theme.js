/* 主题：深色 / 浅色 / 跟随系统，含选项卡控件滑块与 favicon 跟随。
   boot 时机（applyTheme 首调）在 main.js，模块加载期只注册事件。 */
import { $$, reducedMotion } from "./dom.js";

/* 选项卡滑块：跟随激活项的位置与宽度 */
function syncThumb(seg) {
  const thumb = seg.querySelector(".seg-thumb");
  const active = seg.querySelector(".seg-item.active");
  if (!thumb || !active) return;
  thumb.style.width = active.offsetWidth + "px";
  thumb.style.transform = `translateX(${active.offsetLeft - 3}px)`;
}
function syncAllThumbs() { document.querySelectorAll(".seg").forEach(syncThumb); }
window.addEventListener("resize", syncAllThumbs);
window.addEventListener("load", syncAllThumbs);
if (document.fonts && document.fonts.ready) document.fonts.ready.then(syncAllThumbs);

const THEME_KEY = "crm-theme";
const mqLight = matchMedia("(prefers-color-scheme: light)");
let themeMode = "system";
try { themeMode = localStorage.getItem(THEME_KEY) || "system"; } catch (e) {}
if (!["light", "dark", "system"].includes(themeMode)) themeMode = "system";

function effectiveTheme() {
  return themeMode === "system" ? (mqLight.matches ? "light" : "dark") : themeMode;
}
function applyTheme() {
  const t = effectiveTheme();
  document.documentElement.dataset.theme = t;
  document.documentElement.style.colorScheme = t;
  $$(".theme-btn").forEach((b) => b.classList.toggle("active", b.dataset.mode === themeMode));
  syncAllThumbs();
  syncFavicon();
}
/* favicon 跟随主题：浅色用深色标、深色用浅色标，保证浏览器标签栏可见 */
function syncFavicon() {
  const suffix = document.documentElement.dataset.theme === "dark" ? "-dark" : "";
  const svg = document.getElementById("favSvg");
  const png = document.getElementById("favPng");
  if (svg) svg.href = `/static/favicon${suffix}.svg`;
  if (png) png.href = `/static/favicon${suffix}-32x32.png`;
}
function setTheme(mode) {
  themeMode = mode;
  try { localStorage.setItem(THEME_KEY, mode); } catch (e) {}
  const run = () => applyTheme();
  // 页面不可见时 startViewTransition 的回调会被推迟，直接切换
  if (!reducedMotion && !document.hidden && document.startViewTransition) {
    document.startViewTransition(run);           // 整页交叉淡入
  } else {
    document.documentElement.classList.add("theming");
    run();
    setTimeout(() => document.documentElement.classList.remove("theming"), 500);
  }
}
$$(".theme-btn").forEach((b) => b.addEventListener("click", () => setTheme(b.dataset.mode)));

export { themeMode, mqLight, effectiveTheme, applyTheme, setTheme, syncFavicon, syncThumb, syncAllThumbs };
