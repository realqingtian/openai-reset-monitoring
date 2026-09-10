/* 基础 DOM 与字符串工具：选择器、HTML 转义、轻量动效（toast / 数字动画 / 首屏 reveal）。 */
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const esc = (s) => (s || "").replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

let toastTimer = null;
function toast(msg, ok = true) {
  const el = $("#toast");
  el.textContent = msg;
  el.className = "toast" + (ok ? "" : " err");
  el.hidden = false;
  el.style.animation = "none";
  void el.offsetWidth;               // 重置动画，让每次弹出都有滑入
  el.style.animation = "";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 4000);
}
function replay(el, cls) {
  if (reducedMotion || !el) return;
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}
function animateNumber(el, to, suffix = "") {
  const from = parseInt(el.dataset.v || "0", 10) || 0;
  el.dataset.v = String(to);
  if (reducedMotion || from === to) { el.textContent = to + suffix; return; }
  replay(el, "bump");
  const dur = 650, t0 = performance.now();
  const easeOut = (x) => 1 - Math.pow(1 - x, 3);
  const frame = (now) => {
    const p = Math.min(1, (now - t0) / dur);
    el.textContent = Math.round(from + (to - from) * easeOut(p)) + suffix;
    if (p < 1) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

let settled = false;
function reveal(scope) {
  if (settled) return;
  const els = (scope || document).querySelectorAll(".rv:not(.in)");
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
    });
  }, { threshold: 0.06 });
  els.forEach((el, i) => {
    el.style.transitionDelay = Math.min(i * 70, 350) + "ms";
    io.observe(el);
  });
}
/* 首轮入场动画结束后冻结 reveal：后续 60s 刷新不再重播入场 */
function scheduleSettle() {
  if (!settled) setTimeout(() => { settled = true; }, 1600);
}

export { $, $$, esc, escRe, reducedMotion, toast, replay, animateNumber, reveal, scheduleSettle };
