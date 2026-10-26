"""账本只追加；唯一指纹使轮询、重启和并发不会产生重复快照或覆写评估。"""

from typing import Optional

from sqlalchemy import select
from sqlalchemy.dialects.sqlite import insert

from app.db.database import session_factory
from app.models.forecast_history import ForecastEvaluation, ForecastSnapshot


async def append_snapshot(row: dict) -> None:
    async with session_factory() as session:
        await session.execute(insert(ForecastSnapshot).values(**row).on_conflict_do_nothing())
        await session.commit()


async def append_evaluation(row: dict) -> None:
    async with session_factory() as session:
        await session.execute(insert(ForecastEvaluation).values(**row).on_conflict_do_nothing())
        await session.commit()


async def pending() -> list[dict]:
    async with session_factory() as session:
        rows = await session.execute(
            select(ForecastSnapshot)
            .outerjoin(ForecastEvaluation, ForecastEvaluation.snapshot_id == ForecastSnapshot.id)
            .where(ForecastEvaluation.snapshot_id.is_(None))
        )
        return [
            {column.name: getattr(row, column.name) for column in ForecastSnapshot.__table__.columns}
            for row in rows.scalars()
        ]


async def recent(limit: int, before: Optional[str] = None) -> list[dict]:
    async with session_factory() as session:
        query = select(ForecastSnapshot, ForecastEvaluation).outerjoin(
            ForecastEvaluation, ForecastEvaluation.snapshot_id == ForecastSnapshot.id
        )
        if before:
            query = query.where(ForecastSnapshot.created_at < before)
        rows = await session.execute(
            query.order_by(ForecastSnapshot.created_at.desc(), ForecastSnapshot.id.desc()).limit(limit)
        )
        return [
            {
                "id": snapshot.id,
                "created_at": snapshot.created_at,
                "account": snapshot.account,
                "model": snapshot.model,
                "policy_version": snapshot.policy_version,
                "payload": snapshot.payload,
                "evaluation": {
                    "evaluated_at": evaluation.evaluated_at,
                    "outcome": evaluation.outcome,
                    "evidence_ids": evaluation.evidence_ids,
                }
                if evaluation
                else None,
            }
            for snapshot, evaluation in rows
        ]


async def outcomes() -> list[str]:
    async with session_factory() as session:
        return list((await session.execute(select(ForecastEvaluation.outcome))).scalars())
