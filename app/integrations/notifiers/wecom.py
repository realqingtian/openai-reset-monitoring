"""企业微信群机器人 Webhook（text 消息上限约 2048 字节，按字节截断并保底直达链接）。"""

from app.core.config import WecomConfig

# 留出余量的字节上限：正文按 UTF-8 字节截断（中文 3 字节/字，比按字符数截更稳）
MAX_BYTES = 1900


def is_configured(cfg: WecomConfig) -> bool:
    return bool(cfg.webhook.strip())


def _clip_bytes(text: str, limit: int) -> str:
    raw = text.encode("utf-8")
    if len(raw) <= limit:
        return text
    # 忽略尾部可能的半截多字节字符
    return raw[:limit].decode("utf-8", errors="ignore").rstrip()


async def send(client, cfg: WecomConfig, msg):
    content = _clip_bytes(f"{msg['title']}\n{msg['body']}", MAX_BYTES)
    url = (msg.get("url") or "").strip()
    # 富文本模板下链接行在尾部最容易被截掉：补一行直达链接，保住最关键的动作入口
    if url and url not in content:
        content = _clip_bytes(f"{content} …\n{url}", MAX_BYTES)
    resp = await client.post(
        cfg.webhook,
        timeout=15,
        json={
            "msgtype": "text",
            "text": {"content": content},
        },
    )
    resp.raise_for_status()
    data = resp.json()
    ok = data.get("errcode") == 0
    return ok, None if ok else str(data)[:200]
