"""公开健康摘要与管理员投递记录，分别控制数据披露范围。"""

from typing import Literal, Optional

from pydantic import BaseModel, Field

from app.schemas.poll import PollOut
from app.schemas.status import NotifierState, SourceState


class MonitorHealthOut(BaseModel):
    state: Literal["demo", "healthy", "degraded", "offline", "stale", "waiting", "unconfigured"]
    generated_at: str
    last_attempt_at: Optional[str] = None
    last_success_at: Optional[str] = None
    stale_after_seconds: int
    enabled_sources: int
    healthy_sources: int
    channels: list[NotifierState] = Field(default_factory=list)


class DeliveryOut(BaseModel):
    id: int
    ts: Optional[str] = None
    tweet_id: Optional[str] = None
    channel: str
    ok: bool
    error: Optional[str] = None


class ChannelDeliveryOut(NotifierState):
    last_attempt_at: Optional[str] = None
    last_result: Optional[bool] = None
    pending_retries: int = 0


class MonitorAdminOut(BaseModel):
    sources: list[SourceState]
    channels: list[ChannelDeliveryOut]
    polls: list[PollOut]
    deliveries: list[DeliveryOut]
