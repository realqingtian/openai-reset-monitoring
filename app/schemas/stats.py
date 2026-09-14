"""出参模型：/api/stats 重置节奏统计 DTO。"""

from typing import Optional

from pydantic import BaseModel


class DayHitOut(BaseModel):
    """单日命中计数（按 UTC 日聚合），供重置节奏热力图。"""

    day: str  # YYYY-MM-DD
    count: int


class StatsOut(BaseModel):
    """重置节奏统计：全部字段可空（库中尚无命中时前端展示空态）。"""

    total_hits: int = 0
    hits_30d: int = 0
    avg_interval_hours: Optional[float] = None
    last_hit_at: Optional[str] = None
    next_expected_at: Optional[str] = None
    since: Optional[str] = None
    recent_hits: list[str] = []  # 最近若干次命中的发布时间（升序），供迷你时间线
    daily_hits: list[DayHitOut] = []  # 按天命中计数（UTC 日，升序），供热力图
