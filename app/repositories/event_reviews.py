"""串行修订号防止两个管理员页面互相覆盖；所有语句参数绑定。"""

import json

from sqlalchemy import func, select
from sqlalchemy import text as sa_text

from app.core.errors import BizError
from app.db.database import session_factory
from app.models.event_review import EventReview


def serialize(row: EventReview) -> dict:
    return {
        "id": row.id,
        "created_at": row.created_at,
        "actor": row.actor,
        "action": row.action,
        "event_id": row.event_id,
        "reason": row.reason,
        "payload": json.loads(row.payload),
    }


async def all_reviews() -> list[dict]:
    async with session_factory() as session:
        rows = await session.execute(select(EventReview).order_by(EventReview.id))
        return [serialize(row) for row in rows.scalars()]


async def append(row: dict, expected_revision: int) -> int:
    async with session_factory() as session:
        await session.execute(sa_text("BEGIN IMMEDIATE"))
        revision = (await session.execute(select(func.max(EventReview.id)))).scalar() or 0
        if revision != expected_revision:
            raise BizError(409, "事件已被修改，请刷新后重新复核")
        item = EventReview(**{**row, "payload": json.dumps(row["payload"], ensure_ascii=False)})
        session.add(item)
        await session.flush()
        identifier = item.id
        await session.commit()
        return identifier
