"""监控内部状态表（app_state）数据访问：极小的键值存取。

使用方：services/source_watch（数据源自告警状态）、services/account_meta（账号昵称/头像缓存）。
"""

from collections.abc import Mapping
from typing import Optional

from sqlalchemy import delete, select
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from app.core.timeutil import iso_utc
from app.db.database import session_factory
from app.models import AppState


async def get_all() -> dict[str, str]:
    """全量键值对（表行数个位数，不值得按 key 查询）。"""
    async with session_factory() as s:
        rows = (await s.execute(select(AppState))).scalars().all()
        return {r.key: r.value or "" for r in rows}


async def set_many(values: Mapping[str, Optional[str]]):
    """批量 upsert；value 为 None 表示删除该键（告警恢复时清理痕迹）。"""
    async with session_factory() as s:
        for key, value in values.items():
            if value is None:
                await s.execute(delete(AppState).where(AppState.key == key))
                continue
            await s.execute(
                sqlite_insert(AppState)
                .values(key=key, value=value, updated_at=iso_utc())
                .on_conflict_do_update(index_elements=["key"], set_={"value": value, "updated_at": iso_utc()})
            )
        await s.commit()
