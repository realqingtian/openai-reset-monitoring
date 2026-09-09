"""Telegram Bot 消息。保留链接预览，点开卡片即可直达推文。"""
from app.core.config import TelegramConfig


def is_configured(cfg: TelegramConfig) -> bool:
    return bool(cfg.bot_token.strip()) and bool(cfg.chat_id.strip())


async def send(client, cfg: TelegramConfig, msg):
    api = f"https://api.telegram.org/bot{cfg.bot_token}/sendMessage"
    resp = await client.post(api, timeout=15, json={
        "chat_id": str(cfg.chat_id),
        "text": f"{msg['title']}\n\n{msg['body']}",
        "disable_web_page_preview": False,
    })
    resp.raise_for_status()
    data = resp.json()
    ok = data.get("ok") is True
    return ok, None if ok else str(data.get("description") or data)[:200]
