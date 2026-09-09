"""Bark（iOS）推送。server_url 形如 https://api.day.app/你的Key。"""
from urllib.parse import quote

from app.core.config import BarkConfig


def is_configured(cfg: BarkConfig) -> bool:
    return bool(cfg.server_url.strip())


async def send(client, cfg: BarkConfig, msg):
    server = (cfg.server_url or "").rstrip("/")
    path = f"{server}/{quote(msg['title'])}/{quote(msg['body'][:180])}"
    resp = await client.get(path, timeout=15, params={"url": msg["url"], "group": "codex-reset"})
    ok = resp.status_code == 200
    return ok, None if ok else resp.text[:200]
