"""人工判断为独立追加日志，绝不覆盖原帖或已发送记录。"""

from sqlalchemy import Integer, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.database import Base


class EventReview(Base):
    __tablename__ = "event_reviews"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    created_at: Mapped[str] = mapped_column(Text)
    actor: Mapped[str] = mapped_column(Text)
    action: Mapped[str] = mapped_column(Text)
    event_id: Mapped[str] = mapped_column(Text, index=True)
    reason: Mapped[str] = mapped_column(Text)
    payload: Mapped[str] = mapped_column(Text)
