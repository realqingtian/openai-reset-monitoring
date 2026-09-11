"""推文表数据访问：入库去重 / 命中标记 / 推送去重查询。"""

import json
from typing import Any, Optional

from sqlalchemy import select, update
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from app.core.text import content_hash
from app.core.timeutil import iso_utc
from app.db.database import session_factory
from app.models import Tweet
from app.repositories import to_dict


async def upsert_tweet(t: dict[str, Any]) -> bool:
    """按推文 ID 幂等入库（INSERT OR IGNORE）。返回是否为新入库。"""
    async with session_factory() as s:
        stmt = (
            sqlite_insert(Tweet)
            .values(
                id=t["id"],
                account=t["account"],
                text=t["text"],
                url=t["url"],
                created_at=t["created_at"],
                fetched_at=iso_utc(),
                source=t["source"],
                content_hash=content_hash(t["text"]),
                is_reply=t.get("is_reply"),
            )
            .on_conflict_do_nothing(index_elements=["id"])
        )
        result = await s.execute(stmt)
        await s.commit()
        # 类型桩缺口：Result 无 rowcount 属性，运行时 DML 返回的 CursorResult 有
        return result.rowcount > 0  # type: ignore[attr-defined]


async def get_tweet(tweet_id: str) -> Optional[dict[str, Any]]:
    async with session_factory() as s:
        row = (await s.execute(select(Tweet).where(Tweet.id == tweet_id))).scalar_one_or_none()
        return to_dict(row) if row else None


async def tweets_since(iso: str) -> list[dict[str, Any]]:
    async with session_factory() as s:
        rows = (
            (
                await s.execute(
                    select(Tweet).where(Tweet.created_at >= iso).order_by(Tweet.created_at.desc()),
                )
            )
            .scalars()
            .all()
        )
        return [to_dict(r) for r in rows]


async def matched_tweets(limit: int = 100) -> list[dict[str, Any]]:
    async with session_factory() as s:
        rows = (
            (
                await s.execute(
                    select(Tweet).where(Tweet.matched == 1).order_by(Tweet.created_at.desc()).limit(limit),
                )
            )
            .scalars()
            .all()
        )
        return [to_dict(r) for r in rows]


async def mark_hit(tweet_id: str, rule_name: str, terms: list[str]):
    async with session_factory() as s:
        await s.execute(
            update(Tweet)
            .where(Tweet.id == tweet_id)
            .values(matched=1, rule_name=rule_name, matched_terms=json.dumps(terms, ensure_ascii=False)),
        )
        await s.commit()


async def mark_notified(tweet_id: str):
    async with session_factory() as s:
        await s.execute(update(Tweet).where(Tweet.id == tweet_id).values(notified=1))
        await s.commit()


async def account_has_tweets(account: str) -> bool:
    async with session_factory() as s:
        row = (await s.execute(select(Tweet.id).where(Tweet.account == account).limit(1))).first()
        return row is not None


async def hash_already_notified(chash: str, exclude_id: str) -> bool:
    """同内容指纹的推文是否已推送过（用于跨推文的内容去重）。"""
    async with session_factory() as s:
        row = (
            await s.execute(
                select(Tweet.id)
                .where(Tweet.content_hash == chash, Tweet.notified == 1, Tweet.id != exclude_id)
                .limit(1),
            )
        ).first()
        return row is not None


async def notified_texts_since(iso: str) -> list[tuple[str, str]]:
    """取时间窗口内已推送的推文文本，供相似度去重比对。"""
    async with session_factory() as s:
        rows = (
            await s.execute(
                select(Tweet.id, Tweet.text).where(Tweet.notified == 1, Tweet.created_at >= iso),
            )
        ).all()
        return [(r[0], r[1]) for r in rows]
