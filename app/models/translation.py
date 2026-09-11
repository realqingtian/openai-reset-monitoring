"""ORM 模型：译文缓存表（表名 / 列名与旧库 schema 完全一致）。"""

from typing import Optional

from sqlalchemy import Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.database import Base


class Translation(Base):
    __tablename__ = "translations"

    # 推文内容不可变，译文按 (tweet_id, lang) 复合主键永久复用
    tweet_id: Mapped[str] = mapped_column(Text, primary_key=True)
    lang: Mapped[str] = mapped_column(Text, primary_key=True)
    text: Mapped[Optional[str]] = mapped_column(Text)
    provider: Mapped[Optional[str]] = mapped_column(Text)
    created_at: Mapped[Optional[str]] = mapped_column(Text)
