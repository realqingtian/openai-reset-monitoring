"""出参模型：重置日历 DTO。"""

from typing import Optional

from pydantic import BaseModel


class CalendarEventOut(BaseModel):
    """单次重置事件：一条命中公告归入一类（额度重置 / 发重置卡）。"""

    id: str
    created_at: str
    text: str
    url: str
    kind: str  # quota=额度重置 card=发重置卡


class CalendarPredictionOut(BaseModel):
    """下次重置预测：与节奏统计同一口径（命中平均间隔外推），保证两处数字一致。"""

    expected_at: str
    avg_interval_hours: float
    last_hit_at: str


class CalendarOut(BaseModel):
    """月历数据：命中事件流（请求月 ±2 天缓冲，前端按本地时区归日）+ 节奏预测。"""

    events: list[CalendarEventOut] = []
    prediction: Optional[CalendarPredictionOut] = None
