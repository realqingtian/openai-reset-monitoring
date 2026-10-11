"""命中历史仍独立统计；重置预测只使用完成事件与 AI 时间分析。"""

from collections import Counter
from datetime import datetime, timedelta, timezone
from typing import Optional

from app.core.config import Settings
from app.core.timeutil import iso_utc
from app.repositories import tweets as tweet_repo
from app.schemas import DayHitOut, StatsOut
from app.services import reset_forecast

# 采样上限：保留期内命中量级远小于此，仅作防御
SAMPLE_LIMIT = 500
# 迷你时间线最多展示的命中点位数
SPARK_POINTS = 12


def _parse(iso) -> Optional[datetime]:
    try:
        return datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None


async def assemble_stats(cfg: Optional[Settings] = None) -> StatsOut:
    rows = await tweet_repo.matched_tweets(SAMPLE_LIMIT)
    # AI 复核判定为无关的「命中」是正则误报，不进入节奏采样（否则平均间隔被噪声拉偏）
    hits = [h for h in rows if h.get("ai_verdict") != "miss"]
    times = sorted(t for t in (_parse(h["created_at"]) for h in hits) if t)
    now = datetime.now(timezone.utc)
    forecast = await reset_forecast.snapshot(cfg, now)
    avg = forecast.median_interval_hours
    last = times[-1] if times else None
    daily = Counter(t.date().isoformat() for t in times)
    return StatsOut(
        total_hits=len(times),
        hits_30d=sum(1 for t in times if t >= now - timedelta(days=30)),
        avg_interval_hours=round(avg, 1) if avg else None,
        last_hit_at=iso_utc(last) if last else None,
        next_expected_at=forecast.expected_at,
        forecast=forecast,
        since=iso_utc(times[0]) if times else None,
        recent_hits=[iso_utc(t) for t in times[-SPARK_POINTS:]],
        daily_hits=[DayHitOut(day=d, count=n) for d, n in sorted(daily.items())],
    )
