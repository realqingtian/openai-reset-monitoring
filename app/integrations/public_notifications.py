"""标准 SMTP 与可选 pywebpush；失败只返回类型/HTTP 状态，不输出目的地址或凭证。"""

import asyncio
import json
import smtplib
import ssl
from email.message import EmailMessage
from typing import Optional

from app.core.config import Settings


def _mail(cfg: Settings, recipient: str, subject: str, body: str) -> None:
    message = EmailMessage()
    message["From"] = cfg.monitor_smtp_from
    message["To"] = recipient
    message["Subject"] = subject
    message.set_content(body)
    connection = (
        smtplib.SMTP_SSL(cfg.monitor_smtp_host, cfg.monitor_smtp_port, timeout=12, context=ssl.create_default_context())
        if cfg.monitor_smtp_ssl
        else smtplib.SMTP(cfg.monitor_smtp_host, cfg.monitor_smtp_port, timeout=12)
    )
    with connection as smtp:
        if cfg.monitor_smtp_starttls and not cfg.monitor_smtp_ssl:
            smtp.starttls(context=ssl.create_default_context())
        if cfg.monitor_smtp_user:
            smtp.login(cfg.monitor_smtp_user, cfg.monitor_smtp_password)
        smtp.send_message(message)


async def send_email(cfg: Settings, recipient: str, subject: str, body: str) -> tuple[bool, Optional[str]]:
    try:
        await asyncio.to_thread(_mail, cfg, recipient, subject, body)
        return True, None
    except Exception as error:
        return False, type(error).__name__


def _push(cfg: Settings, subscription: dict, payload: dict) -> tuple[bool, bool, Optional[str]]:
    try:
        from pywebpush import WebPushException, webpush
    except ImportError:
        return False, False, "dependency_unavailable"
    try:
        webpush(
            subscription_info=subscription,
            data=json.dumps(payload, ensure_ascii=False),
            vapid_private_key=cfg.monitor_vapid_private_key,
            vapid_claims={"sub": cfg.monitor_vapid_subject},
            ttl=3600,
            timeout=12,
        )
        return True, False, None
    except WebPushException as error:
        code = error.response.status_code if error.response is not None else 0
        return False, code in {404, 410}, f"webpush_http_{code}"
    except Exception as error:
        return False, False, type(error).__name__


async def send_push(cfg: Settings, subscription: dict, payload: dict) -> tuple[bool, bool, Optional[str]]:
    return await asyncio.to_thread(_push, cfg, subscription, payload)
