"""ORM 模型：轮询日志表（表名 / 列名与旧库 schema 完全一致）。"""

from typing import Optional

from sqlalchemy import Integer, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.database import Base


class Poll(Base):
    __tablename__ = "polls"
    # sqlite_autoincrement：保持与旧建表 "id INTEGER PRIMARY KEY AUTOINCREMENT" 一致
    __table_args__ = ({"sqlite_autoincrement": True},)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ts: Mapped[Optional[str]] = mapped_column(Text)
    account: Mapped[Optional[str]] = mapped_column(Text)
    source: Mapped[Optional[str]] = mapped_column(Text)
    ok: Mapped[Optional[int]] = mapped_column(Integer)
    new_tweets: Mapped[Optional[int]] = mapped_column(Integer)
    error: Mapped[Optional[str]] = mapped_column(Text)
    latency_ms: Mapped[Optional[int]] = mapped_column(Integer)
