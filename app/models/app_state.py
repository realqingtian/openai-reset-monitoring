"""ORM 模型：监控内部状态表（键值对），新增表，旧库由 create_all 自动补建。

目前存放数据源自告警的连续失败计数 / 告警激活标记 / 上次告警时间：
放数据库而不是进程内存，保证重启后告警状态不丢（不会重复打扰，也不会漏发恢复通知）。
"""

from typing import Optional

from sqlalchemy import Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.database import Base


class AppState(Base):
    __tablename__ = "app_state"

    key: Mapped[str] = mapped_column(Text, primary_key=True)
    value: Mapped[Optional[str]] = mapped_column(Text)
    updated_at: Mapped[Optional[str]] = mapped_column(Text)
