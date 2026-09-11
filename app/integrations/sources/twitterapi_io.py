"""数据源：twitterapi.io（第三方抓取 API，按量计费，无需 X 账号）。"""

import asyncio
from typing import Any, Optional

from app.core.config import TwitterapiIoConfig
from app.core.timeutil import parse_dt

API_URL = "https://api.twitterapi.io/twitter/user/last_tweets"


def is_configured(scfg: TwitterapiIoConfig) -> bool:
    return bool(scfg.api_key.strip())


async def fetch(client, scfg: TwitterapiIoConfig, account, backfill=False, **_):
    headers = {"X-API-Key": scfg.api_key}
    params = {"userName": account}
    if scfg.include_replies:
        params["includeReplies"] = "true"
    # 首次运行回填历史（多页拿全）；增量时回复模式多拉一页，防止回复在轮询间隔内刷过单页窗口
    max_pages = 5 if backfill else (2 if scfg.include_replies else 1)
    out: list[dict[str, Any]] = []
    cursor: Optional[str] = None
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
            out.append(
                {
                    "id": tid,
                    "account": account,
                    "text": text,
                    "url": t.get("url") or f"https://x.com/{account}/status/{tid}",
                    "created_at": parse_dt(t.get("createdAt")),
                    "source": "twitterapi_io",
                    "is_reply": 1 if t.get("isReply") else 0,
                }
            )
        if not data.get("has_next_page") or not data.get("next_cursor"):
            break
        cursor = data["next_cursor"]
        if page + 1 < max_pages:
            await asyncio.sleep(1.0)  # 翻页间隔，降低触发限流的概率
    return out
