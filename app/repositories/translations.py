"""译文缓存表数据访问：推文内容不可变，译文按 (tweet_id, lang) 永久复用。"""
from typing import Dict, Optional

from sqlalchemy import select
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from app.core.timeutil import iso_utc
from app.db.database import session_factory
from app.models import Translation


async def get_translation(tweet_id: str, lang: str) -> Optional[Dict[str, Optional[str]]]:
    async with session_factory() as s:
        row = (await s.execute(
            select(Translation).where(Translation.tweet_id == tweet_id, Translation.lang == lang),
        )).scalar_one_or_none()
        return {"text": row.text, "provider": row.provider} if row else None


async def save_translation(tweet_id: str, lang: str, text: str, provider: str):
    """按复合主键 (tweet_id, lang) 覆盖写入（等价旧 INSERT OR REPLACE）。"""
    async with session_factory() as s:
        stmt = sqlite_insert(Translation).values(
            tweet_id=tweet_id, lang=lang, text=text, provider=provider, created_at=iso_utc(),
        ).on_conflict_do_update(
            index_elements=["tweet_id", "lang"],
            set_={"text": text, "provider": provider, "created_at": iso_utc()},
        )
        await s.execute(stmt)
        await s.commit()
