/* 帖子翻译：前端 Map + 后端 SQLite 双层缓存，重渲染后自动恢复。
   transClosed 记录用户手动收起的 id：整表重绘后保持收起，不被恢复循环重新展开。 */
import { $, esc, toast } from "./dom.js";
import { lang, t } from "./i18n.js";
import { j } from "./api.js";

const transCache = new Map();
/* 用户手动收起的译文 id：整表重绘后保持收起，不被恢复循环重新展开 */
const transClosed = new Set();
const PROVIDER_LABEL = { google: "Google", mymemory: "MyMemory" };
/* 翻译目标跟随面板语言；原文已是目标语言时不显示按钮 */
function targetLang() { return lang === "zh" ? "zh" : "en"; }
function looksLike(text, tl) {
  const s = (text || "").replace(/\s+/g, "");
  if (!s) return false;
  if (tl === "zh") {
    const cjk = (s.match(/[\u3400-\u9fff\uf900-\ufaff]/g) || []).length;
    return cjk / s.length >= 0.25;
  }
  const ascii = (s.match(/[A-Za-z]/g) || []).length;
  return ascii / s.length >= 0.7;
}
function setTransBtn(btn, translated) {
  btn.querySelector(".act-label").textContent = t(translated ? "hideTrans" : "translate");
}
function fillTransBox(box, text, provider) {
  const p = PROVIDER_LABEL[provider] || (lang === "zh" ? "机翻" : "MT");
  box.innerHTML = `<span class="tr-tag">${esc(t("trTag", { p }))}</span><p class="tr-text">${esc(text)}</p>`;
}
async function toggleTranslate(btn) {
  const id = btn.dataset.id;
  const trBox = btn.closest(".tcard")?.querySelector(".entry-tr");
  if (!trBox) return;
  if (transCache.has(id)) {
    trBox.hidden = !trBox.hidden;
    if (trBox.hidden) transClosed.add(id); else transClosed.delete(id);
    setTransBtn(btn, !trBox.hidden);
    return;
  }
  btn.disabled = true; btn.classList.add("loading");
  btn.querySelector(".act-label").textContent = t("translating");
  try {
    const res = await j(`/api/translate?id=${encodeURIComponent(id)}&to=${targetLang()}`);
    if (res.same) { toast(t("trSame")); btn.querySelector(".act-label").textContent = t("translate"); }
    else {
      transCache.set(id, { text: res.text, provider: res.provider || "" });
      transClosed.delete(id);
      fillTransBox(trBox, res.text, res.provider || "");
      trBox.hidden = false;
      setTransBtn(btn, true);
    }
  } catch (err) {
    toast(t("trFail"), false);
    btn.querySelector(".act-label").textContent = t("translate");
  } finally {
    btn.disabled = false; btn.classList.remove("loading");
  }
}
$("#tweetList").addEventListener("click", (ev) => {
  const btn = ev.target.closest(".entry-act");
  if (btn) toggleTranslate(btn);
});

/* 面板每 60 秒整表重绘，把已取到的译文恢复回去，避免翻译状态丢失；手动收起的保持收起 */
function restoreTranslations(el) {
  el.querySelectorAll(".entry-act").forEach((btn) => {
    const c = transCache.get(btn.dataset.id);
    if (!c) return;
    const box = btn.closest(".tcard")?.querySelector(".entry-tr");
    if (box) {
      fillTransBox(box, c.text, c.provider);
      const open = !transClosed.has(btn.dataset.id);
      box.hidden = !open;
      setTransBtn(btn, open);
    }
  });
}

export { targetLang, looksLike, toggleTranslate, restoreTranslations };
