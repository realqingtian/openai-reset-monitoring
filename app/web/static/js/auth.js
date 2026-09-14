/* 访问令牌：本地保存 + 解锁弹窗。
   面板查看无需令牌；配置了 MONITOR_ACCESS_TOKEN 后，"立即检查"等动作
   收到 401 时弹窗引导输入，保存后由调用方自动重试。留空保存即清除令牌。 */
import { $ } from "./dom.js";
import { t } from "./i18n.js";

const TOKEN_KEY = "crm-token";
let authProtected = false;
let unlockResolve = null;

function getToken() {
  try { return localStorage.getItem(TOKEN_KEY) || ""; } catch (e) { return ""; }
}
function setToken(v) {
  try {
    if (v) localStorage.setItem(TOKEN_KEY, v);
    else localStorage.removeItem(TOKEN_KEY);
  } catch (e) {}
}

/* 由 main.js 在 /api/status 刷新时同步：决定导航栏锁图标是否显示 */
function setProtected(v) {
  authProtected = !!v;
  $("#btnAuth").hidden = !authProtected;
}

function closeDialog(result) {
  const mask = $("#authMask");
  if (!mask || mask.hidden) return;
  mask.hidden = true;
  $("#authInput").value = "";
  if (unlockResolve) { unlockResolve(result); unlockResolve = null; }
}

function requireUnlock() {
  const mask = $("#authMask");
  if (!mask.hidden) return new Promise((resolve) => { unlockResolve = resolve; });
  mask.hidden = false;
  const input = $("#authInput");
  input.value = getToken();
  input.placeholder = t("authPlaceholder");
  input.focus();
  return new Promise((resolve) => { unlockResolve = resolve; });
}

$("#authSave").addEventListener("click", () => {
  setToken($("#authInput").value.trim());
  closeDialog(true);
});
$("#authCancel").addEventListener("click", () => closeDialog(false));
$("#authMask").addEventListener("click", (e) => { if (e.target === e.currentTarget) closeDialog(false); });
$("#authInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); $("#authSave").click(); }
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDialog(false); });
$("#btnAuth").addEventListener("click", () => { requireUnlock(); });

export { getToken, setProtected, requireUnlock };
