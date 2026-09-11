"""ORM 模型：数据源健康表（表名 / 列名与旧库 schema 完全一致）。"""

from typing import Optional

from sqlalchemy import Integer, Text
from sqlalchemy import text as sa_text  # 别名：避免与列名 text 互相遮蔽
from sqlalchemy.orm import Mapped, mapped_column

from app.db.database import Base


class SourceHealth(Base):
    __tablename__ = "source_health"

    source: Mapped[str] = mapped_column(Text, primary_key=True)
    healthy: Mapped[Optional[int]] = mapped_column(Integer)
    failures: Mapped[Optional[int]] = mapped_column(Integer, server_default=sa_text("0"))
    last_ok: Mapped[Optional[str]] = mapped_column(Text)
    last_error: Mapped[Optional[str]] = mapped_column(Text)
    updated_at: Mapped[Optional[str]] = mapped_column(Text)
