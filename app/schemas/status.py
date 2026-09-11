"""出参模型：/api/status 聚合状态 DTO。"""

from typing import Optional

from pydantic import BaseModel

from app.schemas.tweet import TweetOut


class SourceState(BaseModel):
    """数据源状态。"""

    name: str
    enabled: bool
    configured: bool
    known: bool
    healthy: bool
    failures: int
    last_ok: Optional[str] = None
    last_error: Optional[str] = None


class NotifierState(BaseModel):
    """通知渠道状态。"""

    name: str
    enabled: bool
    configured: bool


class RuleInfo(BaseModel):
    """展示用命中规则。"""

    name: Optional[str] = None
    patterns: list[str] = []


class StatusOut(BaseModel):
    """/api/status 聚合状态：字段与旧版 dict 完全一致。"""

    demo: bool
    debug: bool
    env_mode: str
    site_name: Optional[str] = None
    config_file: Optional[str] = None
    accounts: list[str]
    poll_interval_minutes: int
    lookback_hours: int
    last_poll_at: Optional[str] = None
    tweets_24h: int
    hit_count_24h: int
    latest_hit: Optional[TweetOut] = None
    hits: list[TweetOut]
    sources: list[SourceState]
    notifiers: list[NotifierState]
    rules: list[RuleInfo]
