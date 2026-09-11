"""ORM 模型：推文表（表名 / 列名与旧库 schema 完全一致）。

约定：主键 Mapped 非可选；其余列全部 Optional，与旧库 nullable=True 语义一致，
业务写入方自行保证必填列有值。
"""

from typing import Optional

from sqlalchemy import Index, Integer, Text
from sqlalchemy import text as sa_text  # 别名：避免与下方 text 列名互相遮蔽
from sqlalchemy.orm import Mapped, mapped_column

from app.db.database import Base


class Tweet(Base):
    __tablename__ = "tweets"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    account: Mapped[Optional[str]] = mapped_column(Text)
    text: Mapped[Optional[str]] = mapped_column(Text)
    url: Mapped[Optional[str]] = mapped_column(Text)
    created_at: Mapped[Optional[str]] = mapped_column(Text)  # UTC ISO 字符串，固定宽度可直接字符串比较
    fetched_at: Mapped[Optional[str]] = mapped_column(Text)
    source: Mapped[Optional[str]] = mapped_column(Text)
    matched: Mapped[Optional[int]] = mapped_column(Integer, server_default=sa_text("0"))
    rule_name: Mapped[Optional[str]] = mapped_column(Text)
    matched_terms: Mapped[Optional[str]] = mapped_column(Text)  # JSON 数组字符串，用于面板高亮
    notified: Mapped[Optional[int]] = mapped_column(Integer, server_default=sa_text("0"))
    content_hash: Mapped[Optional[str]] = mapped_column(Text)  # 内容指纹，用于跨推文去重

    __table_args__ = (
        Index("idx_tweets_created", "created_at"),
        Index("idx_tweets_hash", "content_hash"),
    )
