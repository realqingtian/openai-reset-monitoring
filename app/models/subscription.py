"""访客独立授权及投递幂等队列；不混用管理员通知表。"""

from typing import Optional

from sqlalchemy import Boolean, Integer, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.database import Base


class PublicSubscription(Base):
    __tablename__ = "public_subscriptions"
    id: Mapped[str] = mapped_column(Text, primary_key=True)
    channel: Mapped[str] = mapped_column(Text)
    destination: Mapped[str] = mapped_column(Text)
    destination_hash: Mapped[str] = mapped_column(Text, unique=True)
    confirmed: Mapped[bool] = mapped_column(Boolean, default=False)
    active: Mapped[bool] = mapped_column(Boolean, default=False)
    generation: Mapped[int] = mapped_column(Integer, default=1)
    preferences: Mapped[str] = mapped_column(Text)
    pending_preferences: Mapped[str] = mapped_column(Text)
    confirm_hash: Mapped[Optional[str]] = mapped_column(Text)
    confirmation_at: Mapped[str] = mapped_column(Text)
    active_since: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[str] = mapped_column(Text)
    updated_at: Mapped[str] = mapped_column(Text)


class PublicDelivery(Base):
    __tablename__ = "public_deliveries"
    __table_args__ = (UniqueConstraint("subscription_id", "event_key", name="uq_public_delivery_event"),)
    id: Mapped[str] = mapped_column(Text, primary_key=True)
    subscription_id: Mapped[str] = mapped_column(Text, index=True)
    event_key: Mapped[str] = mapped_column(Text)
    payload: Mapped[str] = mapped_column(Text)
    state: Mapped[str] = mapped_column(Text)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    next_attempt_at: Mapped[str] = mapped_column(Text)
    created_at: Mapped[str] = mapped_column(Text)
    updated_at: Mapped[str] = mapped_column(Text)
    error: Mapped[Optional[str]] = mapped_column(Text)
