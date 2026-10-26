"""健康状态按最近成功抓取判定，避免把页面可访问或最近失败时间误当数据新鲜。"""

import re
from datetime import datetime, timezone
from typing import Optional

from app.core.config import Settings
from app.core.timeutil import hours_ago_iso, iso_utc
from app.integrations.notifiers import notifier_states
from app.integrations.sources import source_states
from app.repositories import healths, polls
from app.repositories import monitor as monitor_repo
from app.schemas.monitor import ChannelDeliveryOut, DeliveryOut, MonitorAdminOut, MonitorHealthOut
from app.schemas.poll import PollOut
from app.schemas.status import SourceState
from app.services.reset_forecast import parse_time


def health_state(
    sources: list[dict], last_success: Optional[str], stale_after: int, now: datetime, demo: bool = False
) -> str:
    if demo:
        return "demo"
    active = [s for s in sources if s["enabled"] and s["configured"]]
    if not active:
        return "unconfigured"
    known = [s for s in active if s["known"]]
    healthy = [s for s in known if s["healthy"]]
    if known and len(known) == len(active) and not healthy:
        return "offline"
    last = parse_time(last_success)
    if last is not None and (now - last).total_seconds() > stale_after:
        return "stale"
    if not last or not known:
        return "waiting"
    return "healthy" if len(healthy) == len(active) else "degraded"


async def summary(cfg: Settings) -> MonitorHealthOut:
    now = datetime.now(timezone.utc)
    sources = source_states(cfg, await healths.get_healths())
    last = await monitor_repo.last_successful_poll()
    recent = await polls.recent_polls(1)
    threshold = max(120, cfg.poll_interval_minutes * 120 + 30)
    return MonitorHealthOut.model_validate(
        {
            "state": health_state(sources, last, threshold, now, cfg.demo),
            "generated_at": iso_utc(now),
            "last_attempt_at": recent[0]["ts"] if recent else None,
            "last_success_at": last,
            "stale_after_seconds": threshold,
            "enabled_sources": sum(s["enabled"] and s["configured"] for s in sources),
            "healthy_sources": sum(s["enabled"] and s["configured"] and s["healthy"] for s in sources),
            "channels": notifier_states(cfg),
        }
    )


def safe_error(value: Optional[str], cfg: Settings) -> Optional[str]:
    if not value:
        return value
    # 外部错误可能带鉴权 URL 或上游回显；即使管理员视图也不返回这些凭证。
    secrets = [
        v
        for k, v in cfg.model_dump().items()
        if isinstance(v, str)
        and any(part in k for part in ("key", "token", "password", "secret", "webhook", "bark_url"))
        and v
    ]
    for secret in sorted(secrets, key=len, reverse=True):
        value = value.replace(secret, "[redacted]")
    value = re.sub(r"https?://[^\s<>]+", "[upstream URL]", value)
    value = re.sub(r"(?i)bearer\s+\S+", "Bearer [redacted]", value)
    return value[:500]


async def admin_details(cfg: Settings, limit: int = 200) -> MonitorAdminOut:
    from app.services import review_state

    source_rows = source_states(cfg, await healths.get_healths())
    for source in source_rows:
        source["last_error"] = safe_error(source.get("last_error"), cfg)
    poll_rows = await polls.recent_polls(limit)
    for row in poll_rows:
        row["error"] = safe_error(row.get("error"), cfg)
    delivery = await monitor_repo.delivery_state(
        hours_ago_iso(cfg.lookback_hours), limit, list(await review_state.suppressed_ids())
    )
    for row in delivery["recent"]:
        row["error"] = safe_error(row.get("error"), cfg)
    channels = []
    for channel in notifier_states(cfg):
        latest = delivery["channels"].get(channel["name"], {})
        channels.append(
            ChannelDeliveryOut(
                **channel,
                last_attempt_at=latest.get("ts"),
                last_result=bool(latest["ok"]) if latest.get("ok") is not None else None,
                pending_retries=delivery["pending"].get(channel["name"], 0)
                if channel["enabled"] and channel["configured"]
                else 0,
            )
        )
    return MonitorAdminOut(
        sources=[SourceState.model_validate(row) for row in source_rows],
        channels=channels,
        polls=[PollOut.model_validate(row) for row in poll_rows],
        deliveries=[DeliveryOut.model_validate(row) for row in delivery["recent"]],
    )
