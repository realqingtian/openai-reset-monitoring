"""通知日志表数据访问。"""

from typing import Optional

from app.core.timeutil import iso_utc
from app.db.database import session_factory
from app.models import NotifyLog


async def log_notify(tweet_id: str, channel: str, ok: bool, error: Optional[str] = None):
    async with session_factory() as s:
        s.add(NotifyLog(ts=iso_utc(), tweet_id=tweet_id, channel=channel, ok=int(bool(ok)), error=error))
        await s.commit()
