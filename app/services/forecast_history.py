"""从上线时开始记录，不回填历史预测；评估衡量公告窗口，不能代表个人到账准确率。"""

import hashlib
import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from app.core.config import Settings
from app.core.timeutil import iso_utc
from app.integrations.ai import default_model
from app.repositories import forecast_history as repository
from app.schemas.forecast import ResetForecastOut
from app.services import events, monitor, reset_forecast

POLICY = "announcement-window-v1"
log = logging.getLogger("forecast_history")


def evaluate(snapshot: dict, actual: list, now: datetime) -> Optional[dict]:
    forecast = ResetForecastOut.model_validate_json(snapshot["payload"])
    start, end = reset_forecast.parse_time(forecast.window_start), reset_forecast.parse_time(forecast.window_end)
    created = reset_forecast.parse_time(snapshot["created_at"])
    if (
        not snapshot.get("account")
        or not start
        or not end
        or not created
        or forecast.status not in {"announced", "estimated"}
        or created >= start
    ):
        return {"outcome": "ineligible", "evidence_ids": []}
    # 留出一天抓取延迟，不因刚到窗口结束、尚未抓到公告而立刻记为失败。
    if now < end + timedelta(days=1):
        return None
    inside = []
    for event in actual:
        at = reset_forecast.parse_time(event.completed_at)
        if (
            event.account == snapshot["account"]
            and event.kind == "quota"
            and event.phase == "completed"
            and at
            and created < at
            and start <= at <= end
        ):
            inside.append(event)
    return {"outcome": "within_window" if inside else "outside_window", "evidence_ids": [event.id for event in inside]}


async def capture(cfg: Settings) -> None:
    if cfg.demo:
        return
    try:
        now = datetime.now(timezone.utc)
        forecast = await reset_forecast.snapshot(cfg, now)
        candidates = await reset_forecast.candidates(now)
        accounts = {row["account"] for row in candidates}
        # 同一证据与模型只保存首次看到的预测，不把过期后的状态再保存成新预测。
        signature = reset_forecast.fingerprint(candidates, cfg)
        payload = forecast.model_dump_json()
        model = f"{cfg.ai.provider}/{default_model(cfg.ai)}" if forecast.method.startswith("ai_") else "deterministic"
        identifier = hashlib.sha256(
            (
                signature
                + POLICY
                + model
                + str(forecast.window_start)
                + str(forecast.window_end)
                + forecast.method
                + (forecast.reason_code if not forecast.window_end else "")
            ).encode()
        ).hexdigest()
        await repository.append_snapshot(
            {
                "id": identifier,
                "created_at": iso_utc(now),
                "account": next(iter(accounts)) if len(accounts) == 1 else "",
                "model": model,
                "policy_version": POLICY,
                "payload": payload,
            }
        )
        actual = await events.all_events(cfg)
        health = await monitor.summary(cfg)
        last_success = reset_forecast.parse_time(health.last_success_at)
        for record in await repository.pending():
            result = evaluate(record, actual, now)
            end = reset_forecast.parse_time(json.loads(record["payload"]).get("window_end"))
            if (
                result
                and result["outcome"] != "ineligible"
                and (not last_success or (end and last_success < end + timedelta(days=1)))
            ):
                continue
            if result is not None:
                await repository.append_evaluation(
                    {
                        "snapshot_id": record["id"],
                        "evaluated_at": iso_utc(now),
                        "outcome": result["outcome"],
                        "evidence_ids": json.dumps(result["evidence_ids"]),
                    }
                )
    except Exception:
        log.exception("预测账本记录失败，不影响公告通知")


async def history(limit: int) -> dict:
    rows = await repository.recent(limit)
    for row in rows:
        row["forecast"] = json.loads(row.pop("payload"))
        if row["evaluation"]:
            row["evaluation"]["evidence_ids"] = json.loads(row["evaluation"]["evidence_ids"])
    outcomes = await repository.outcomes()
    eligible = sum(result in {"within_window", "outside_window"} for result in outcomes)
    success = outcomes.count("within_window")
    return {
        "items": rows,
        "evaluated": eligible,
        "within_window": success,
        "window_match_rate": round(success / eligible, 4) if eligible >= 5 else None,
        "minimum_samples": 5,
        "policy_version": POLICY,
    }
