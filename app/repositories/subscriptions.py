"""订阅写入与队列领取使用短事务；对外不返回邮箱、推送地址或确认令牌。"""

from datetime import datetime, timedelta, timezone
from typing import Any, Optional, cast

from sqlalchemy import select, update
from sqlalchemy import text as sa_text
from sqlalchemy.dialects.sqlite import insert
from sqlalchemy.engine import CursorResult

from app.core.timeutil import iso_utc
from app.db.database import session_factory
from app.models.subscription import PublicDelivery, PublicSubscription


def subscription_dict(row: PublicSubscription) -> dict:
    return {column.name: getattr(row, column.name) for column in PublicSubscription.__table__.columns}


async def by_id(identifier: str) -> Optional[dict]:
    async with session_factory() as session:
        row = await session.get(PublicSubscription, identifier)
        return subscription_dict(row) if row else None


async def by_destination(digest: str) -> Optional[dict]:
    async with session_factory() as session:
        row = (
            await session.execute(select(PublicSubscription).where(PublicSubscription.destination_hash == digest))
        ).scalar_one_or_none()
        return subscription_dict(row) if row else None


async def save(row: dict) -> None:
    async with session_factory() as session:
        result = await session.execute(
            insert(PublicSubscription)
            .values(**row)
            .on_conflict_do_update(
                index_elements=[PublicSubscription.id],
                set_=row,
                where=PublicSubscription.generation == row["generation"],
            )
        )
        if cast(CursorResult[Any], result).rowcount == 0:
            from app.core.errors import BizError

            raise BizError(409, "订阅已改变，请重试")
        await session.commit()


async def active() -> list[dict]:
    async with session_factory() as session:
        rows = await session.execute(
            select(PublicSubscription).where(
                PublicSubscription.active.is_(True), PublicSubscription.confirmed.is_(True)
            )
        )
        return [subscription_dict(row) for row in rows.scalars()]


async def enqueue(row: dict) -> None:
    async with session_factory() as session:
        await session.execute(insert(PublicDelivery).values(**row).on_conflict_do_nothing())
        await session.commit()


async def claim() -> Optional[dict]:
    now = iso_utc(datetime.now(timezone.utc))
    async with session_factory() as session:
        await session.execute(sa_text("BEGIN IMMEDIATE"))
        row = (
            await session.execute(
                select(PublicDelivery)
                .where(
                    PublicDelivery.state.in_(["pending", "retry", "processing"]), PublicDelivery.next_attempt_at <= now
                )
                .order_by(PublicDelivery.created_at)
                .limit(1)
            )
        ).scalar_one_or_none()
        if row is None:
            return None
        row.state = "processing"
        row.attempts += 1
        row.next_attempt_at = iso_utc(datetime.now(timezone.utc) + timedelta(minutes=2))
        await session.commit()
        return {column.name: getattr(row, column.name) for column in PublicDelivery.__table__.columns}


async def finish(identifier: str, success: bool, permanent: bool, error: Optional[str]) -> None:
    async with session_factory() as session:
        row = await session.get(PublicDelivery, identifier)
        if not row:
            return
        row.state = "delivered" if success else "stopped" if permanent or row.attempts >= 5 else "retry"
        row.error = error
        now = datetime.now(timezone.utc)
        row.updated_at = iso_utc(now)
        row.next_attempt_at = iso_utc(now + timedelta(seconds=min(3600, 30 * 2**row.attempts)))
        await session.commit()


async def recent(identifier: str) -> list[dict]:
    async with session_factory() as session:
        rows = await session.execute(
            select(PublicDelivery)
            .where(PublicDelivery.subscription_id == identifier)
            .order_by(PublicDelivery.created_at.desc())
            .limit(10)
        )
        return [{"state": row.state, "attempts": row.attempts, "updated_at": row.updated_at} for row in rows.scalars()]


async def change(identifier: str, values: dict, generation: int, confirm_hash: Optional[str] = None) -> bool:
    async with session_factory() as session:
        statement = update(PublicSubscription).where(
            PublicSubscription.id == identifier, PublicSubscription.generation == generation
        )
        if confirm_hash is not None:
            statement = statement.where(PublicSubscription.confirm_hash == confirm_hash)
        result = await session.execute(statement.values(**values))
        changed = cast(CursorResult[Any], result).rowcount > 0
        await session.commit()
        return changed
