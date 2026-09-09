"""企业微信群机器人 Webhook（text 消息上限约 2048 字节，这里截断到 600 字符）。"""

MAX_CHARS = 600


def is_configured(cfg):
    return bool((cfg or {}).get("webhook"))


async def send(client, cfg, msg):
    content = f"{msg['title']}\n{msg['body']}"[:MAX_CHARS]
    resp = await client.post(cfg["webhook"], timeout=15, json={
        "msgtype": "text",
        "text": {"content": content},
    })
    resp.raise_for_status()
    data = resp.json()
    ok = data.get("errcode") == 0
    return ok, None if ok else str(data)[:200]
