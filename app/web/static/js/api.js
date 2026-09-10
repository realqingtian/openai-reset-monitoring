/* 后端 API 访问：/api/* 统一 {code, data, message} 包体。 */
/* 后端 /api/* 统一返回 {code, data, message} 包体：非 2xx、包体非法或 code!==200 时抛错，成功返回 data */
async function j(url, opt) {
  const r = await fetch(url, opt);
  let body = null;
  try { body = await r.json(); } catch (e) { body = null; }
  if (!r.ok || !body || body.code !== 200) {
    throw new Error((body && body.message) || `HTTP ${r.status}`);
  }
  return body.data;
}

export { j };
