/* 后端 /api/* 统一返回 {code, data, message} 包体：非 2xx、包体非法或 code!==200 时抛错，成功返回 data。
   已保存访问令牌时自动携带 X-Access-Token；401 错误带 auth 标记，供调用方触发解锁弹窗后重试。 */
async function j(url, opt = {}) {
  const headers = Object.assign({}, opt.headers || {});
  try {
    const tok = localStorage.getItem("crm-token");
    if (tok) headers["X-Access-Token"] = tok;
  } catch (e) {}
  const r = await fetch(url, Object.assign({}, opt, { headers }));
  let body = null;
  try { body = await r.json(); } catch (e) { body = null; }
  if (!r.ok || !body || body.code !== 200) {
    const err = new Error((body && body.message) || `HTTP ${r.status}`);
    if (body && body.code === 401) err.auth = true;
    throw err;
  }
  return body.data;
}

export { j };
