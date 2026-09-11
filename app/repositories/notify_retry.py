"""通知日志表的补推读路径：候选推文、渠道最新结果。

独立成文件的原因：补推是新增读路径，查询面向 notify_log 与 tweets 两表，
与写入侧 notifies.py 分离便于审查。全部查询为 SQLAlchemy 参数化表达，
无任何字符串拼接。
"""

from typing import Any

from sqlalchemy import select

from app.db.database import session_factory
from app.models import NotifyLog, Tweet
from app.repositories import to_dict


async def attempted_tweet_ids() -> set[str]:
    """历史上发起过推送尝试的推文 ID 集合（含失败）。"""
    async with session_factory() as s:
        rows = (await s.execute(select(NotifyLog.tweet_id).distinct())).all()
        return {r[0] for r in rows}


async def latest_channel_results(tweet_id: str) -> dict[str, bool]:
    """该推文每个渠道最近一次的推送结果：{channel: ok}。从未尝试过则返回 {}。

    供补推扫描使用：按 id 升序遍历后写覆盖，即得各渠道最新状态。
    """
    async with session_factory() as s:
        stmt = select(NotifyLog).filter_by(tweet_id=tweet_id).order_by(NotifyLog.id)
        rows = (await s.execute(stmt)).scalars().all()
        return {r.channel: bool(r.ok) for r in rows if r.channel is not None}


async def retry_candidates(window_start: str, attempted: set[str]) -> list[dict[str, Any]]:
    """补推扫描候选：窗口内命中且未标记已推送的推文，仅保留有过尝试记录的。

    无渠道尝试记录的不纳入（命中时未配置渠道的推文维持"不补推"的既定取舍）。
    """
    async with session_factory() as s:
        stmt = select(Tweet).filter_by(matched=1, notified=0).order_by(Tweet.created_at.desc())
        rows = (await s.execute(stmt)).scalars().all()
    return [to_dict(r) for r in rows if r.created_at is not None and r.created_at >= window_start and r.id in attempted]
