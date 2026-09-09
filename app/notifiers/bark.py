"""Bark（iOS）推送。server_url 形如 https://api.day.app/你的Key。"""
from urllib.parse import quote


def is_configured(cfg):
    return bool((cfg or {}).get("server_url"))


async def send(client, cfg, msg):
    server = (cfg["server_url"] or "").rstrip("/")
    path = f"{server}/{quote(msg['title'])}/{quote(msg['body'][:180])}"
    resp = await client.get(path, timeout=15, params={"url": msg["url"], "group": "codex-reset"})
    ok = resp.status_code == 200
    return ok, None if ok else resp.text[:200]
