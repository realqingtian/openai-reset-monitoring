"""数据源健康表数据访问。"""

from typing import Optional

from sqlalchemy import select

from app.core.timeutil import iso_utc
from app.db.database import session_factory
from app.models import SourceHealth
from app.repositories import to_dict


async def set_health(source: str, healthy: bool, error: Optional[str] = None):
    """更新数据源健康状态：成功清零失败计数，失败累加（与旧 set_health 逻辑一致）。"""
    async with session_factory() as s:
        row = (
            await s.execute(
                select(SourceHealth).where(SourceHealth.source == source),
            )
        ).scalar_one_or_none()
        if row is None:
            row = SourceHealth(source=source)
            s.add(row)
        row.healthy = int(bool(healthy))
        row.failures = 0 if healthy else ((row.failures or 0) + 1)
        row.last_ok = iso_utc() if healthy else row.last_ok
        row.last_error = None if healthy else error
        row.updated_at = iso_utc()
        await s.commit()


async def get_healths() -> dict[str, dict]:
    """{source: 状态 dict}，供面板展示。"""
    async with session_factory() as s:
        rows = (await s.execute(select(SourceHealth))).scalars().all()
        return {r.source: to_dict(r) for r in rows}
