"""数据源自监控：连续整轮失败达到阈值 → 经已配置渠道发故障告警；恢复后发恢复通知。

存在意义：监控自身最大的静默风险是数据源挂掉（X 反爬曾致 RSSHub 路由恒返回空 feed），
没有自告警时用户只能靠面板红色状态肉眼发现。状态存 app_state 表而非进程内存：
重启后不重复告警打扰，也不漏发恢复通知。

判定口径：一轮 = run_poll 一次完整执行；仅统计「已启用且配置了凭证的数据源全部失败」的账号，
什么源都没配置（空跑）不算失败；任一账号成功即视为本轮健康（DEMO 模式整体跳过）。
"""

import logging
from datetime import datetime, timezone

from app.core.config import Settings
from app.core.timeutil import iso_utc
from app.integrations.notifiers import send_alert
from app.repositories import app_state as state_repo

log = logging.getLogger("source_watch")

# app_state 键名
KEY_CONSECUTIVE = "source_alert_consecutive"  # 连续失败轮数
KEY_ACTIVE = "source_alert_active"  # "1"=告警中
KEY_LAST_SENT = "source_alert_last_sent"  # 上次告警发送时间（UTC ISO，含重发）
KEY_SINCE = "source_alert_since"  # 首次失败时间，用于恢复消息里的故障时长


def _parse_iso(value: str) -> datetime:
    return datetime.fromisoformat(str(value).replace("Z", "+00:00"))


def _hours_since(value: str) -> float:
    """距 value 的小时数；解析失败按 0 处理（只影响恢复消息里的时长展示）。"""
    try:
        return max(0.0, (datetime.now(timezone.utc) - _parse_iso(value)).total_seconds() / 3600)
    except ValueError:
        return 0.0


async def observe(cfg: Settings, client, result: dict) -> None:
    """每轮轮询结束后调用一次。result 为 run_poll 的返回摘要（异常轮由 poll_loop 构造）。"""
    threshold = cfg.source_alert_threshold
    if cfg.demo or threshold <= 0:
        return

    state = await state_repo.get_all()
    consecutive = int(state.get(KEY_CONSECUTIVE) or 0)
    active = state.get(KEY_ACTIVE) == "1"

    if result.get("ok"):
        if not active and consecutive == 0:
            return  # 健康且无告警痕迹：不写库，避免每轮无谓写入
        if active:
            since = state.get(KEY_SINCE) or ""
            await send_alert(
                cfg,
                client,
                "recover",
                {
                    "accounts": result.get("accounts") or [],
                    "hours_down": _hours_since(since),
                    "panel_url": cfg.monitor_public_url,
                },
            )
            log.info("数据源已恢复，恢复通知已发送（故障自 %s 起）", since or "未知时间")
        await state_repo.set_many({KEY_CONSECUTIVE: None, KEY_ACTIVE: None, KEY_LAST_SENT: None, KEY_SINCE: None})
        return

    consecutive += 1
    since = state.get(KEY_SINCE) or iso_utc()
    updates: dict[str, str] = {KEY_CONSECUTIVE: str(consecutive), KEY_SINCE: since}

    last_sent = state.get(KEY_LAST_SENT) or ""
    repeat_minutes = cfg.source_alert_repeat_minutes
    should_alert = False
    if not active and consecutive >= threshold:
        should_alert = True
    elif active and repeat_minutes > 0:
        # 告警中按节奏重发：发送当时渠道可能自身故障，重发给丢失的告警一次补投机会
        try:
            elapsed_min = (
                (datetime.now(timezone.utc) - _parse_iso(last_sent)).total_seconds() / 60 if last_sent else 1e9
            )
        except ValueError:
            elapsed_min = 1e9
        if elapsed_min >= repeat_minutes:
            should_alert = True

    if should_alert:
        errors = [e for e in (result.get("errors") or []) if e]
        await send_alert(
            cfg,
            client,
            "alert",
            {
                "accounts": result.get("failed_accounts") or result.get("accounts") or [],
                "consecutive": consecutive,
                "since_iso": since,
                "last_error": errors[-1] if errors else "",
                "panel_url": cfg.monitor_public_url,
            },
        )
        updates[KEY_ACTIVE] = "1"
        updates[KEY_LAST_SENT] = iso_utc()
        log.warning("数据源连续失败 %d 轮，告警已发送", consecutive)

    await state_repo.set_many(updates)
