"""公告分类与独立事件读模型，保留每一条原始证据。"""

from typing import Literal, Optional

from pydantic import BaseModel, Field

from app.schemas.tweet import TweetOut

EventKind = Literal["quota", "card", "other"]
EventPhase = Literal["completed", "scheduled", "unknown"]


class ResetEventOut(BaseModel):
    id: str
    account: str
    kind: EventKind
    phase: EventPhase
    announced_at: str
    updated_at: str
    completed_at: Optional[str] = None
    window_start: Optional[str] = None
    window_end: Optional[str] = None
    evidence: list[TweetOut] = Field(default_factory=list)


class EventPageOut(BaseModel):
    items: list[ResetEventOut]
    total: int
    next_cursor: Optional[str] = None
    completed_30d: int = 0
    cards_30d: int = 0
