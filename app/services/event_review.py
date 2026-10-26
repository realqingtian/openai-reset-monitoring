"""管理员纠错的验证与事件合并；审计理由仅管理员可读。"""

from datetime import datetime, timezone
from typing import Optional

from app.core.config import Settings
from app.core.errors import BizError
from app.core.timeutil import iso_utc
from app.repositories import event_reviews, tweets
from app.schemas.event import ResetEventOut
from app.services import review_state


def merge_events(groups: list[ResetEventOut], reviews: list[dict]) -> list[ResetEventOut]:
    active: dict[str, Optional[dict]] = {}
    for review in reviews:
        if review["action"] in {"merge", "unmerge"}:
            active[review["event_id"]] = review if review["action"] == "merge" else None
    for active_review in active.values():
        if not active_review:
            continue
        source_ids = set(active_review["payload"]["source_ids"])
        target_id = active_review["payload"]["target_id"]
        source = next((event for event in groups if source_ids.intersection(s.id for s in event.evidence)), None)
        target = next(
            (event for event in groups if target_id == event.id or any(s.id == target_id for s in event.evidence)), None
        )
        if (
            not source
            or not target
            or source is target
            or source.account != target.account
            or source.kind != target.kind
        ):
            continue
        target.evidence = sorted(
            {s.id: s for s in [*target.evidence, *source.evidence]}.values(), key=lambda s: (s.created_at, s.id)
        )
        target.announced_at = min(target.announced_at, source.announced_at)
        target.updated_at = max(target.updated_at, source.updated_at)
        if source.completed_at:
            target.completed_at = min(source.completed_at, target.completed_at or source.completed_at)
            target.phase = "completed"
        groups.remove(source)
    return sorted(groups, key=lambda event: (event.updated_at, event.id), reverse=True)


async def submit(cfg: Settings, body, actor: str) -> dict:
    from app.services import events

    groups = await events.all_events(cfg, include_withdrawn=True)
    source = next(
        (
            event
            for event in groups
            if event.id == body.event_id or any(row.id == body.event_id for row in event.evidence)
        ),
        None,
    )
    if source is None:
        raise BizError(404, "事件不存在")
    source_ids = [row.id for row in source.evidence]
    payload = {
        "source_ids": source_ids,
        "before": source.model_dump(mode="json"),
        "kind": body.kind,
        "phase": body.phase,
        "target_id": body.target_id,
    }
    if body.action == "classify" and (body.kind is None or body.phase is None):
        raise BizError(400, "分类和阶段必填")
    if body.action == "merge":
        target = next((event for event in groups if event.id == body.target_id), None)
        if not target or target is source or target.account != source.account or target.kind != source.kind:
            raise BizError(400, "仅可合并同账号、同类型的两个独立事件")
        payload["target_id"] = target.id
    identifier = await event_reviews.append(
        {
            "created_at": iso_utc(datetime.now(timezone.utc)),
            "actor": actor,
            "action": body.action,
            "event_id": body.event_id,
            "reason": body.reason.strip(),
            "payload": payload,
        },
        body.expected_revision,
    )
    return {"revision": identifier}


async def audit(limit: int) -> dict:
    _, withdrawn, rows = await review_state.state()
    ids = [identifier for identifier, removed in withdrawn.items() if removed]
    sources = await tweets.tweet_page(None, None, identifiers=ids) if ids else []
    return {
        "revision": rows[-1]["id"] if rows else 0,
        "items": list(reversed(rows))[:limit],
        "withdrawn": [
            {"id": row["id"], "account": row["account"], "created_at": row["created_at"], "text": row["text"]}
            for row in sources
        ],
    }
