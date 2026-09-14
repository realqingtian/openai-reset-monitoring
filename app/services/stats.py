"""重置节奏统计：基于命中历史推算平均间隔与下次预期窗口，供面板统计卡展示。

估算口径：一次命中 ≈ 一次重置公告；转发/修正可能带来短间隔噪声样本（推送侧有
相似度去重，命中侧没有），统计只求趋势参考，不做精确承诺。相邻零间隔（同刻）
的样本不计入均值，避免除零与偏斜。
"""

from datetime import datetime, timedelta, timezone
from typing import Optional

from app.core.timeutil import iso_utc
from app.repositories import tweets as tweet_repo
from app.schemas import StatsOut

# 采样上限：保留期内命中量级远小于此，仅作防御
SAMPLE_LIMIT = 500
# 迷你时间线最多展示的命中点位数
SPARK_POINTS = 12


def _parse(iso) -> Optional[datetime]:
    try:
        return datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None


async def assemble_stats() -> StatsOut:
    hits = await tweet_repo.matched_tweets(SAMPLE_LIMIT)
    times = sorted(t for t in (_parse(h["created_at"]) for h in hits) if t)
    now = datetime.now(timezone.utc)
    intervals = [(b - a).total_seconds() / 3600 for a, b in zip(times, times[1:]) if (b - a).total_seconds() > 0]
    avg = sum(intervals) / len(intervals) if intervals else None
    last = times[-1] if times else None
    return StatsOut(
        total_hits=len(times),
        hits_30d=sum(1 for t in times if t >= now - timedelta(days=30)),
        avg_interval_hours=round(avg, 1) if avg else None,
        last_hit_at=iso_utc(last) if last else None,
        next_expected_at=iso_utc(last + timedelta(hours=avg)) if avg and last else None,
        since=iso_utc(times[0]) if times else None,
        recent_hits=[iso_utc(t) for t in times[-SPARK_POINTS:]],
    )
