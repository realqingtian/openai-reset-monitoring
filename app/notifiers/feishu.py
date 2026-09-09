"""飞书群机器人 Webhook。"""


def is_configured(cfg):
    return bool((cfg or {}).get("webhook"))


async def send(client, cfg, msg):
    resp = await client.post(cfg["webhook"], timeout=15, json={
        "msg_type": "text",
        "content": {"text": f"{msg['title']}\n{msg['body']}"},
    })
    resp.raise_for_status()
    data = resp.json()
    code = data.get("code", data.get("StatusCode", 0))
    return int(code or 0) == 0, None if int(code or 0) == 0 else str(data)[:200]
