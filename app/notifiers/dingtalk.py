"""钉钉群机器人 Webhook。消息带固定前缀，便于配合机器人的"自定义关键词"安全设置。"""

PREFIX = "【Codex重置监控】"


def is_configured(cfg):
    return bool((cfg or {}).get("webhook"))


async def send(client, cfg, msg):
    resp = await client.post(cfg["webhook"], timeout=15, json={
        "msgtype": "text",
        "text": {"content": f"{PREFIX}{msg['title']}\n{msg['body']}"},
    })
    resp.raise_for_status()
    data = resp.json()
    ok = data.get("errcode") == 0
    return ok, None if ok else str(data)[:200]
