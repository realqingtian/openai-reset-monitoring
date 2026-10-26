"""访客双重确认、能力令牌和独立队列。只通知注册后新事件，不补发整段历史。"""

import asyncio
import base64
import hashlib
import hmac
import importlib.util
import json
import logging
import secrets
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse

from app.core.config import Settings
from app.core.errors import BizError
from app.core.timeutil import iso_utc
from app.integrations import public_notifications
from app.repositories import subscriptions as repository
from app.services import events
from app.services.exports import title
from app.services.reset_forecast import parse_time

log = logging.getLogger("public_subscriptions")
_lock = asyncio.Lock()


def readiness(cfg: Settings) -> dict:
    base = urlparse(cfg.monitor_public_base_url)
    valid_base = bool(
        base.hostname
        and not base.username
        and not base.password
        and not base.query
        and not base.fragment
        and base.path in {"", "/"}
        and (base.scheme == "https" or (base.scheme == "http" and base.hostname in {"localhost", "127.0.0.1", "::1"}))
    )
    enabled = (
        cfg.monitor_public_subscriptions and valid_base and len(cfg.monitor_subscription_secret) >= 32 and not cfg.demo
    )
    email = (
        enabled
        and bool(cfg.monitor_smtp_host and cfg.monitor_smtp_from)
        and (
            cfg.monitor_smtp_starttls
            or cfg.monitor_smtp_ssl
            or cfg.monitor_smtp_host in {"localhost", "127.0.0.1", "::1"}
        )
    )
    push = (
        enabled
        and bool(cfg.monitor_vapid_public_key and cfg.monitor_vapid_private_key and cfg.monitor_vapid_subject)
        and importlib.util.find_spec("pywebpush") is not None
    )
    return {
        "enabled": enabled,
        "email": email,
        "webpush": push,
        "vapid_public_key": cfg.monitor_vapid_public_key if push else None,
    }


def require_channel(cfg: Settings, channel: str) -> None:
    if not readiness(cfg).get(channel):
        raise BizError(503, "该访客订阅渠道尚未配置")


def digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def management_token(cfg: Settings, row: dict) -> str:
    raw = row["id"] + "." + str(row["generation"])
    signature = hmac.new(cfg.monitor_subscription_secret.encode(), raw.encode(), hashlib.sha256).hexdigest()
    return raw + "." + signature


async def managed(cfg: Settings, token: str) -> dict:
    if not readiness(cfg)["enabled"]:
        raise BizError(503, "访客订阅未启用")
    identifier = token.split(".", 1)[0]
    row = await repository.by_id(identifier)
    if row is None or not hmac.compare_digest(management_token(cfg, row), token):
        raise BizError(403, "订阅管理链接无效或已失效")
    return row


def valid_push(value: dict) -> dict:
    endpoint = value["endpoint"]
    parsed = urlparse(endpoint)
    host = (parsed.hostname or "").lower()
    allowed = (
        host in {"fcm.googleapis.com", "updates.push.services.mozilla.com", "web.push.apple.com"}
        or host.endswith(".push.apple.com")
        or host.endswith(".notify.windows.com")
    )
    if (
        parsed.scheme != "https"
        or parsed.port not in {None, 443}
        or parsed.username
        or parsed.password
        or parsed.fragment
        or not allowed
    ):
        raise BizError(400, "不支持的浏览器推送地址")
    for field, length in [("p256dh", 65), ("auth", 16)]:
        raw = value["keys"][field]
        try:
            decoded = base64.b64decode(raw + "=" * (-len(raw) % 4), altchars=b"-_", validate=True)
        except ValueError as error:
            raise BizError(400, "推送密钥格式错误") from error
        if len(decoded) != length or (field == "p256dh" and decoded[0] != 4):
            raise BizError(400, "推送密钥格式错误")
    return {"endpoint": endpoint, "keys": {"p256dh": value["keys"]["p256dh"], "auth": value["keys"]["auth"]}}


async def subscribe(cfg: Settings, channel: str, destination: str, preferences: dict) -> dict:
    require_channel(cfg, channel)
    now = datetime.now(timezone.utc)
    async with _lock:
        existing = await repository.by_destination(digest(channel + ":" + destination))
        if existing and channel == "email":
            sent = parse_time(existing["confirmation_at"])
            if sent and now - sent < timedelta(hours=1):
                return {"confirmation_required": True}
        token = secrets.token_urlsafe(32)
        row = existing or {
            "id": secrets.token_hex(16),
            "created_at": iso_utc(now),
            "generation": 1,
            "active": False,
            "active_since": "",
            "confirmed": False,
            "preferences": json.dumps(preferences),
        }
        row.update(
            channel=channel,
            destination=destination,
            destination_hash=digest(channel + ":" + destination),
            pending_preferences=json.dumps(preferences),
            confirmation_at=iso_utc(now),
            updated_at=iso_utc(now),
            confirm_hash=digest(token) if channel == "email" else None,
        )
        if channel == "webpush":
            if not row["active"]:
                row["active_since"] = iso_utc(now)
            row.update(active=True, confirmed=True, preferences=json.dumps(preferences))
        await repository.save(row)
    if channel == "email":
        link = cfg.monitor_public_base_url.rstrip("/") + "/#email-confirm=" + row["id"] + "." + token
        zh = preferences["lang"] == "zh"
        subject = "确认 Codex 公告订阅" if zh else "Confirm Codex announcement subscription"
        body = (
            "请打开以下链接确认订阅。24 小时内有效；如非本人请求，请忽略。\n"
            if zh
            else "Open this link to confirm within 24 hours. Ignore if you did not request it.\n"
        ) + link
        accepted, failure = await public_notifications.send_email(cfg, destination, subject, body)
        if not accepted:
            log.warning("访客确认邮件未被渠道接收：%s", failure)
            # 返回相同提示，避免通过失败差异枚举既有邮箱；允许稍后再次请求确认。
            await repository.change(
                row["id"],
                {"confirmation_at": iso_utc(now - timedelta(hours=1))},
                row["generation"],
                row["confirm_hash"],
            )
        return {"confirmation_required": True}
    return {"confirmation_required": False, "token": management_token(cfg, row)}


async def confirm(cfg: Settings, token: str) -> dict:
    require_channel(cfg, "email")
    identifier, _, value = token.partition(".")
    async with _lock:
        row = await repository.by_id(identifier)
        now = datetime.now(timezone.utc)
        sent = parse_time(row["confirmation_at"]) if row else None
        if (
            row is None
            or row["channel"] != "email"
            or not row["confirm_hash"]
            or not sent
            or now - sent > timedelta(days=1)
            or not hmac.compare_digest(row["confirm_hash"], digest(value))
        ):
            raise BizError(400, "确认链接无效或已过期")
        values = {
            "active": True,
            "confirmed": True,
            "confirm_hash": None,
            "preferences": row["pending_preferences"],
            "updated_at": iso_utc(now),
        }
        if not row["active"]:
            values["active_since"] = iso_utc(now)
        if not await repository.change(row["id"], values, row["generation"], row["confirm_hash"]):
            raise BizError(409, "订阅已改变，请重新确认")
        row.update(values)
        return {"token": management_token(cfg, row)}


async def manage(cfg: Settings, token: str, preferences=None, unsubscribe: bool = False) -> dict:
    async with _lock:
        row = await managed(cfg, token)
        if unsubscribe:
            values = {
                "active": False,
                "generation": row["generation"] + 1,
                "confirm_hash": None,
                "updated_at": iso_utc(datetime.now(timezone.utc)),
            }
            if not await repository.change(row["id"], values, row["generation"]):
                raise BizError(409, "订阅已改变，请刷新")
            return {"active": False}
        if preferences is not None:
            values = {"preferences": json.dumps(preferences), "updated_at": iso_utc(datetime.now(timezone.utc))}
            if not await repository.change(row["id"], values, row["generation"]):
                raise BizError(409, "订阅已改变，请刷新")
            row.update(values)
        return {
            "active": row["active"],
            "channel": row["channel"],
            "preferences": json.loads(row["preferences"]),
            "deliveries": await repository.recent(row["id"]),
        }


async def queue_events(cfg: Settings) -> None:
    if not readiness(cfg)["enabled"]:
        return
    try:
        now = datetime.now(timezone.utc)
        groups = await events.all_events(cfg)
        for row in await repository.active():
            prefs = json.loads(row["preferences"])
            for event in groups:
                updated = parse_time(event.updated_at)
                created = parse_time(row["active_since"] or row["created_at"])
                if (
                    event.kind not in prefs["kinds"]
                    or event.phase not in prefs["phases"]
                    or not updated
                    or not created
                    or updated < created
                    or now - updated > timedelta(days=1)
                ):
                    continue
                key = digest(event.id + ":" + event.kind + ":" + event.phase)
                payload = {
                    "title": title(event, prefs["lang"]),
                    "kind": event.kind,
                    "phase": event.phase,
                    "source_ids": [source.id for source in event.evidence],
                    "body": event.evidence[-1].text[:200] if event.evidence else "",
                    "tag": "reset-" + key,
                    "url": cfg.monitor_public_base_url.rstrip("/") + "/#reset-events",
                }
                await repository.enqueue(
                    {
                        "id": secrets.token_hex(16),
                        "subscription_id": row["id"],
                        "event_key": key,
                        "payload": json.dumps(payload, ensure_ascii=False),
                        "state": "pending",
                        "attempts": 0,
                        "next_attempt_at": iso_utc(now),
                        "created_at": iso_utc(now),
                        "updated_at": iso_utc(now),
                        "error": None,
                    }
                )
    except Exception as error:
        log.warning("访客通知入队失败：%s", type(error).__name__)


async def deliver_one(cfg: Settings) -> bool:
    job = await repository.claim()
    if job is None:
        return False
    row = await repository.by_id(job["subscription_id"])
    if not row or not row["active"] or not row["confirmed"] or not readiness(cfg).get(row["channel"]):
        await repository.finish(job["id"], False, True, "inactive_or_unavailable")
        return True
    if datetime.now(timezone.utc) - (parse_time(job["created_at"]) or datetime.now(timezone.utc)) > timedelta(days=1):
        await repository.finish(job["id"], False, True, "expired")
        return True
    payload = json.loads(job["payload"])
    preferences = json.loads(row["preferences"])
    from app.services import review_state

    suppressed = await review_state.suppressed_ids()
    if (
        payload.get("kind") not in preferences["kinds"]
        or payload.get("phase") not in preferences["phases"]
        or (payload.get("source_ids") and all(identifier in suppressed for identifier in payload["source_ids"]))
    ):
        await repository.finish(job["id"], False, True, "preference_or_review_changed")
        return True
    if row["channel"] == "email":
        manage_url = cfg.monitor_public_base_url.rstrip("/") + "/#subscription=" + management_token(cfg, row)
        body = payload["body"] + "\n\n" + payload["url"] + "\n\nManage preferences / 退订与偏好:\n" + manage_url
        success, error = await public_notifications.send_email(cfg, row["destination"], payload["title"], body)
        permanent = False
    else:
        success, permanent, error = await public_notifications.send_push(cfg, json.loads(row["destination"]), payload)
        if permanent:
            await repository.change(
                row["id"], {"active": False, "generation": row["generation"] + 1}, row["generation"]
            )
    await repository.finish(job["id"], success, permanent, error)
    return True


async def delivery_loop(cfg: Settings) -> None:
    while True:
        try:
            if readiness(cfg)["enabled"]:
                for _ in range(10):
                    if not await deliver_one(cfg):
                        break
        except Exception as error:
            log.warning("访客投递失败：%s", type(error).__name__)
        await asyncio.sleep(15)
