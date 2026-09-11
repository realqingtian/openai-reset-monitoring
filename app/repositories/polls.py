"""轮询日志表数据访问。"""

from typing import Any, Optional

from sqlalchemy import select

from app.core.timeutil import iso_utc
from app.db.database import session_factory
from app.models import Poll
from app.repositories import to_dict


async def log_poll(
    account: str,
    source: str,
    ok: bool,
    new_tweets: int = 0,
    error: Optional[str] = None,
    latency_ms: Optional[int] = None,
):
    async with session_factory() as s:
        s.add(
            Poll(
                ts=iso_utc(),
                account=account,
                source=source,
                ok=int(bool(ok)),
                new_tweets=new_tweets,
                error=error,
                latency_ms=latency_ms,
            )
        )
        await s.commit()


async def recent_polls(limit: int = 30) -> list[dict[str, Any]]:
    async with session_factory() as s:
        rows = (await s.execute(select(Poll).order_by(Poll.id.desc()).limit(limit))).scalars().all()
        return [to_dict(r) for r in rows]
