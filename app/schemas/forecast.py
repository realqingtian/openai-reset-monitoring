"""预测独立于公告命中：提供参考窗口、证据与不能预测的明确原因。"""

from typing import Optional

from pydantic import BaseModel, Field


class ForecastEvidenceOut(BaseModel):
    id: str
    text: str
    url: str
    published_at: str
    analysis: Optional[str] = None


class ResetForecastOut(BaseModel):
    status: str = "unavailable"  # announced / estimated / expired / unavailable
    method: str = "none"  # ai_announcement / ai_history / history / none
    confidence: str = "none"
    window_start: Optional[str] = None
    window_end: Optional[str] = None
    expected_at: Optional[str] = None  # 兼容旧客户端，界面使用完整窗口
    reason_code: str = "insufficient"
    sample_events: int = 0
    sample_posts: int = 0
    sample_since: Optional[str] = None
    sample_until: Optional[str] = None
    median_interval_hours: Optional[float] = None
    last_reset_at: Optional[str] = None  # 完成公告的发布时间，并非个人额度实际刷新时刻
    evidence_ids: list[str] = Field(default_factory=list)
    evidence: list[ForecastEvidenceOut] = Field(default_factory=list)
    ai_reason: Optional[str] = None
    analyzed_at: Optional[str] = None
