"""重置日历用例：命中事件归类（额度重置 / 发重置卡）+ 节奏预测，供月历视图展示。

事件口径与节奏统计一致：AI 判定无关的帖子不计入。优先复用 AI 的类型与阶段；
没有有效分析时保守识别完成公告，其余保留未知阶段，不自动假定六小时后生效。
"""

from datetime import datetime, timedelta, timezone
from typing import Optional

from app.core.config import Settings
from app.core.timeutil import iso_utc
from app.schemas import CalendarEventOut, CalendarOut, CalendarPredictionOut
from app.services import events as event_service
from app.services import stats as stats_service

# 窗口缓冲：本地时区（如 UTC+8）的月份边界与 UTC 最多差 1 天，取 2 天冗余，
# 前端按本地日归组后再裁回当月
BUFFER = timedelta(days=2)
# 事件卡只展示引言，全文经「在 X 上查看」直达
TEXT_LIMIT = 240


async def assemble_calendar(year: int, month: int, cfg: Optional[Settings] = None) -> CalendarOut:
    """取指定月份（UTC 口径 ±2 天缓冲）的重置事件流，附下次重置预测。"""
    start = datetime(year, month, 1, tzinfo=timezone.utc) - BUFFER
    nxt_year, nxt_month = (year + 1, 1) if month == 12 else (year, month + 1)
    end = datetime(nxt_year, nxt_month, 1, tzinfo=timezone.utc) + BUFFER
    stats = await stats_service.assemble_stats(cfg)
    independent = await event_service.all_events(cfg)
    events = []
    for event in independent:
        published = event.completed_at or event.announced_at
        if not iso_utc(start) <= published < iso_utc(end) or not event.evidence:
            continue
        source = event.evidence[-1]
        events.append(
            CalendarEventOut(
                id=source.id,
                event_id=event.id,
                created_at=published,
                text=source.text[:TEXT_LIMIT],
                url=source.url,
                kind=event.kind,
                phase=event.phase,
                evidence=event.evidence,
            )
        )
    events.sort(key=lambda e: e.created_at, reverse=True)
    # 旧 API 字段保留兼容，前端统一展示 forecast 窗口，避免各处自行外推。
    prediction = None
    if stats.next_expected_at and stats.avg_interval_hours and stats.last_hit_at:
        prediction = CalendarPredictionOut(
            expected_at=stats.next_expected_at,
            avg_interval_hours=stats.avg_interval_hours,
            last_hit_at=stats.last_hit_at,
        )
    return CalendarOut(events=events, prediction=prediction, forecast=stats.forecast)
