"""统一公告分类与事件归组；读接口只复用已有分析，绝不调用 AI 或触发通知。"""

import base64
import json
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from app.core.config import Settings
from app.core.errors import BizError
from app.core.text import normalize_text
from app.core.timeutil import iso_utc
from app.repositories import tweets
from app.schemas.event import EventKind, EventPageOut, EventPhase, ResetEventOut
from app.schemas.tweet import TweetOut
from app.services import event_review, reset_forecast, review_state

_QUOTE = re.compile(r"(?:Tibo|Thibault Sottiaux):")
_CARD = re.compile(r"banked reset|reset card|储备重置|重置卡", re.I)
_SCHEDULED = re.compile(r"\b(?:will|tomorrow|tonight|landing|by midnight|by EOD)\b|将于|即将|明天|今晚", re.I)


def classify(rows: list[dict[str, Any]], analysis: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    known = {event["id"]: event for event in analysis}
    completed = {event["id"] for event in reset_forecast.fallback_events(rows) if event["phase"] == "completed"}
    output = {}
    for row in rows:
        body = _QUOTE.split(row.get("text") or "", maxsplit=1)[0]
        relevant = row.get("ai_verdict") != "miss" and bool(row.get("matched") or row.get("ai_verdict") == "hit")
        kind = "card" if relevant and _CARD.search(body) else "quota" if relevant else "other"
        phase = (
            "completed"
            if row["id"] in completed
            else "scheduled"
            if relevant and (_SCHEDULED.search(body) or reset_forecast.is_reset_day_pledge(body))
            else "unknown"
        )
        metadata = {"id": row["id"], "kind": kind, "phase": phase, "explicit": False, "start": None, "end": None}
        # 有效 AI 分析优先；已判无关的记录不能被旧缓存或兜底重新标为公告。
        if relevant and row["id"] in known:
            metadata.update(known[row["id"]])
        metadata = reset_forecast.bound_completion_to_source(metadata, body)
        # “正在装载卡片”是发放预告，不能仅因旧模型将其标完成就宣称已到账。
        if (
            not metadata.get("manual")
            and metadata["kind"] == "card"
            and re.search(r"\bloading\b", body, re.I)
            and not re.search(r"\b(?:completed|finished|confirmed|available|propagated)\b", body, re.I)
        ):
            metadata["phase"] = "scheduled"
        output[row["id"]] = metadata
    return output


async def annotations(rows: list[dict[str, Any]], cfg: Optional[Settings]) -> dict[str, dict[str, Any]]:
    analysis = []
    if cfg and cfg.ai.enabled and cfg.monitor_ai_forecast and not cfg.demo:
        candidates = await reset_forecast.candidates(datetime.now(timezone.utc))
        cache = await reset_forecast.read_cache()
        if cache.get("fingerprint") == reset_forecast.fingerprint(candidates, cfg) and isinstance(
            cache.get("events"), list
        ):
            try:
                analysis = [
                    reset_forecast.AnalysisEvent.model_validate(event).model_dump(mode="json")
                    for event in cache["events"]
                ]
            except (ValueError, TypeError):
                analysis = []
    analysis, _ = await review_state.apply_analysis(rows, analysis)
    return classify(rows, analysis)


def group_events(rows: list[dict[str, Any]], metadata: dict[str, dict[str, Any]]) -> list[ResetEventOut]:
    groups: list[ResetEventOut] = []
    for row in sorted(rows, key=lambda row: (row["created_at"], row["id"])):
        if not row.get("matched") or row.get("ai_verdict") == "miss":
            continue
        published = reset_forecast.parse_time(row["created_at"])
        if published is None or published > datetime.now(timezone.utc):
            continue
        meta = metadata[row["id"]]
        evidence = TweetOut.model_validate({**row, "kind": meta["kind"], "phase": meta["phase"]})
        time = iso_utc(published)
        compatible = [event for event in groups if event.account == row["account"] and event.kind == meta["kind"]]
        target = None
        # 明确引用先前公告时关联同一事件；发卡不套用额度刷新六小时规则。
        quotes = _QUOTE.split(row.get("text") or "", maxsplit=1)
        quoted = normalize_text(quotes[1]) if len(quotes) > 1 else ""
        referenced = [
            event
            for event in compatible
            if len(quoted) >= 12
            and timedelta(0)
            <= published - datetime.fromisoformat(event.announced_at.replace("Z", "+00:00"))
            <= timedelta(days=7)
            and any(quoted in normalize_text(_QUOTE.split(source.text, maxsplit=1)[0]) for source in event.evidence)
        ]
        if len(referenced) == 1:
            target = referenced[0]
        if target is None and meta["phase"] == "completed" and meta["kind"] != "other":
            # 延续既有六小时完成公告去重口径，不跨账号，也不把发卡并入额度刷新。
            close = [
                event
                for event in compatible
                if meta["kind"] == "quota"
                and event.completed_at
                and timedelta(0)
                <= published - datetime.fromisoformat(event.completed_at.replace("Z", "+00:00"))
                < timedelta(hours=6)
            ]
            if close:
                target = close[-1]
            else:
                pending = []
                quotes = _QUOTE.split(row.get("text") or "", maxsplit=1)
                quoted = normalize_text(quotes[1]) if len(quotes) > 1 else ""
                for event in compatible:
                    if event.phase != "scheduled":
                        continue
                    start = reset_forecast.parse_time(event.window_start)
                    end = reset_forecast.parse_time(event.window_end)
                    in_window = bool(start and end and start <= published <= end + timedelta(hours=6))
                    cites_source = len(quoted) >= 12 and any(
                        quoted in normalize_text(_QUOTE.split(source.text, maxsplit=1)[0]) for source in event.evidence
                    )
                    age = published - datetime.fromisoformat(event.announced_at.replace("Z", "+00:00"))
                    # 无具体时刻的「今天重置」也会有独立完成帖；唯一的近期同类承诺可自动关联。
                    day_pledge = (
                        meta["kind"] == "quota"
                        and not start
                        and not end
                        and age <= timedelta(days=1)
                        and any(reset_forecast.is_reset_day_pledge(source.text) for source in event.evidence)
                    )
                    if timedelta(0) <= age <= timedelta(days=7) and (in_window or cites_source or day_pledge):
                        pending.append(event)
                # 多个合理候选时仍自动记录本次完成，只保留为独立事件，不猜测对应关系。
                if len(pending) == 1:
                    target = pending[0]
        if target is None:
            target = ResetEventOut(
                id=row["id"],
                account=row["account"],
                kind=meta["kind"],
                phase=meta["phase"],
                announced_at=time,
                updated_at=time,
                window_start=meta.get("start") if meta.get("explicit") else None,
                window_end=meta.get("end") if meta.get("explicit") else None,
            )
            groups.append(target)
        target.evidence.append(evidence)
        target.updated_at = time
        if meta["phase"] == "completed":
            target.phase = "completed"
            target.completed_at = target.completed_at or time
    return sorted(groups, key=lambda event: (event.updated_at, event.id), reverse=True)


async def all_events(cfg: Optional[Settings], include_withdrawn: bool = False) -> list[ResetEventOut]:
    rows = await tweets.tweet_page(None, None, matched=True)
    metadata = await annotations(rows, cfg)
    _, withdrawn, reviews = await review_state.state()
    visible = rows if include_withdrawn else [row for row in rows if not withdrawn.get(row["id"])]
    return event_review.merge_events(group_events(visible, metadata), reviews)


def encode_cursor(event: ResetEventOut) -> str:
    return base64.urlsafe_b64encode(json.dumps([event.updated_at, event.id]).encode()).decode().rstrip("=")


def decode_cursor(value: str) -> tuple[str, str]:
    try:
        pair = json.loads(base64.urlsafe_b64decode(value + "=" * (-len(value) % 4)))
        if not isinstance(pair, list) or len(pair) != 2 or not all(isinstance(v, str) for v in pair):
            raise ValueError
        if reset_forecast.parse_time(pair[0]) is None or not pair[1] or len(pair[1]) > 200:
            raise ValueError
        return pair[0], pair[1]
    except (ValueError, TypeError, UnicodeError) as error:
        raise BizError(400, "无效的事件分页位置") from error


async def page(
    cfg: Settings,
    limit: int,
    before: Optional[str] = None,
    kind: Optional[EventKind] = None,
    phase: Optional[EventPhase] = None,
    account: Optional[str] = None,
) -> EventPageOut:
    events = await all_events(cfg)
    if account is not None:
        events = [event for event in events if event.account == account]
    cutoff = iso_utc(datetime.now(timezone.utc) - timedelta(days=30))
    completed = sum(e.kind == "quota" and e.phase == "completed" and (e.completed_at or "") >= cutoff for e in events)
    cards = sum(e.kind == "card" and e.announced_at >= cutoff for e in events)
    selected = [
        e
        for e in events
        if (kind is None or e.kind == kind)
        and (phase is None or e.phase == phase)
        and (account is None or e.account == account)
    ]
    total = len(selected)
    if before:
        cursor = decode_cursor(before)
        selected = [e for e in selected if (e.updated_at, e.id) < cursor]
    items = selected[:limit]
    return EventPageOut(
        items=items,
        total=total,
        completed_30d=completed,
        cards_30d=cards,
        next_cursor=encode_cursor(items[-1]) if len(selected) > limit else None,
    )
