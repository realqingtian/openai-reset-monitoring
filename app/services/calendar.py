"""重置日历用例：命中事件归类（额度重置 / 发重置卡）+ 节奏预测，供月历视图展示。

事件口径与节奏统计一致：AI 复核判定为无关的正则误报不算重置事件。分类靠正文
关键词，「发卡」类公告（banked reset / reset card）归发重置卡，其余默认额度重置。
"""

from datetime import datetime, timedelta, timezone

from app.core.timeutil import iso_utc
from app.repositories import tweets as tweet_repo
from app.schemas import CalendarEventOut, CalendarOut, CalendarPredictionOut
from app.services import stats as stats_service

# 窗口缓冲：本地时区（如 UTC+8）的月份边界与 UTC 最多差 1 天，取 2 天冗余，
# 前端按本地日归组后再裁回当月
BUFFER = timedelta(days=2)
# 事件卡只展示引言，全文经「在 X 上查看」直达
TEXT_LIMIT = 240
# 「发重置卡」特征词：命中任意即归此类，其余命中一律视为额度重置
CARD_KEYWORDS = ("reset card", "banked reset")


def _classify(text: str) -> str:
    t = (text or "").lower()
    return "card" if any(k in t for k in CARD_KEYWORDS) else "quota"


async def assemble_calendar(year: int, month: int) -> CalendarOut:
    """取指定月份（UTC 口径 ±2 天缓冲）的重置事件流，附下次重置预测。"""
    start = datetime(year, month, 1, tzinfo=timezone.utc) - BUFFER
    nxt_year, nxt_month = (year + 1, 1) if month == 12 else (year, month + 1)
    end = datetime(nxt_year, nxt_month, 1, tzinfo=timezone.utc) + BUFFER
    rows = await tweet_repo.matched_tweets_between(iso_utc(start), iso_utc(end))
    events = [
        CalendarEventOut(
            id=r["id"],
            created_at=r["created_at"],
            text=(r["text"] or "")[:TEXT_LIMIT],
            url=r["url"],
            kind=_classify(r["text"]),
        )
        for r in rows
        if r.get("ai_verdict") != "miss"
    ]
    events.sort(key=lambda e: e.created_at, reverse=True)
    # 预测直接复用节奏统计结果：与节奏卡/倒计时同一套数字，避免两处口径漂移
    stats = await stats_service.assemble_stats()
    prediction = None
    if stats.next_expected_at and stats.avg_interval_hours and stats.last_hit_at:
        prediction = CalendarPredictionOut(
            expected_at=stats.next_expected_at,
            avg_interval_hours=stats.avg_interval_hours,
            last_hit_at=stats.last_hit_at,
        )
    return CalendarOut(events=events, prediction=prediction)
