"""数据源：twitterapi.io（第三方抓取 API，按量计费，无需 X 账号）。"""
import asyncio

from app.util import parse_dt

API_URL = "https://api.twitterapi.io/twitter/user/last_tweets"


def is_configured(scfg):
    return bool((scfg or {}).get("api_key"))


async def fetch(client, scfg, account, backfill=False, **_):
    headers = {"X-API-Key": scfg["api_key"]}
    params = {"userName": account}
    max_pages = 5 if backfill else 1  # 首次运行回填历史，之后每次只拉最新一页（增量）
    out, cursor = [], None
    for page in range(max_pages):
        if cursor:
            params["cursor"] = cursor
        try:
            resp = await client.get(API_URL, params=params, headers=headers, timeout=30)
            resp.raise_for_status()
            data = resp.json()
        except Exception:
            # 首页失败视为源不可用；翻页失败（常见于连续翻页触发 429 限流）
            # 保留已获取的推文并停止翻页，不浪费成功的请求
            if out:
                break
            raise
        status = data.get("status")
        if status not in (None, "success"):
            raise RuntimeError(f"twitterapi.io 返回异常状态: {status}")
        for t in data.get("tweets") or []:
            tid = str(t.get("id") or "").strip()
            text = (t.get("text") or "").strip()
            if not tid or not text:
                continue
            out.append({
                "id": tid,
                "account": account,
                "text": text,
                "url": t.get("url") or f"https://x.com/{account}/status/{tid}",
                "created_at": parse_dt(t.get("createdAt")),
                "source": "twitterapi_io",
            })
        if not data.get("has_next_page") or not data.get("next_cursor"):
            break
        cursor = data["next_cursor"]
        if page + 1 < max_pages:
            await asyncio.sleep(1.0)  # 翻页间隔，降低触发限流的概率
    return out
