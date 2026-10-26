"""监控读模型：数据库端归组选出最新投递，不以最近一页代替全部补推状态。"""

from typing import Any, Optional

from sqlalchemy import func, or_, select

from app.db.database import session_factory
from app.models import NotifyLog, Poll, Tweet
from app.repositories import to_dict


async def last_successful_poll() -> Optional[str]:
    async with session_factory() as s:
        return (await s.execute(select(func.max(Poll.ts)).where(Poll.ok == 1))).scalar_one()


async def delivery_state(window_start: str, limit: int = 200, excluded: Optional[list[str]] = None) -> dict[str, Any]:
    async with session_factory() as s:
        recent = (await s.execute(select(NotifyLog).order_by(NotifyLog.id.desc()).limit(limit))).scalars().all()
        channel_ids = select(func.max(NotifyLog.id)).group_by(NotifyLog.channel)
        channels = (await s.execute(select(NotifyLog).where(NotifyLog.id.in_(channel_ids)))).scalars().all()
        latest_ids = select(func.max(NotifyLog.id)).group_by(NotifyLog.tweet_id, NotifyLog.channel)
        pending = (
            await s.execute(
                select(NotifyLog.channel, func.count())
                .join(Tweet, Tweet.id == NotifyLog.tweet_id)
                .where(
                    NotifyLog.id.in_(latest_ids),
                    NotifyLog.ok == 0,
                    Tweet.id.not_in(excluded or []),
                    Tweet.matched == 1,
                    Tweet.notified == 0,
                    Tweet.created_at >= window_start,
                    or_(Tweet.ai_verdict.is_(None), Tweet.ai_verdict != "miss"),
                )
                .group_by(NotifyLog.channel)
            )
        ).all()
        return {
            "recent": [to_dict(row) for row in recent],
            "channels": {row.channel: to_dict(row) for row in channels},
            "pending": {channel: count for channel, count in pending if channel is not None},
        }
