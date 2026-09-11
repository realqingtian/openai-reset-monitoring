"""ORM 模型：通知日志表（表名 / 列名与旧库 schema 完全一致）。"""

from typing import Optional

from sqlalchemy import Integer, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.database import Base


class NotifyLog(Base):
    __tablename__ = "notify_log"
    __table_args__ = ({"sqlite_autoincrement": True},)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ts: Mapped[Optional[str]] = mapped_column(Text)
    tweet_id: Mapped[Optional[str]] = mapped_column(Text)
    channel: Mapped[Optional[str]] = mapped_column(Text)
    ok: Mapped[Optional[int]] = mapped_column(Integer)
    error: Mapped[Optional[str]] = mapped_column(Text)
