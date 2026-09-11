"""轮询日志查询：面板检查日志列表。"""

from app.repositories import polls as poll_repo
from app.schemas import PollOut


async def list_polls(limit: int) -> list[PollOut]:
    """最近 N 条检查日志（按时间倒序），供 /api/polls 展示。"""
    return [PollOut.model_validate(r) for r in await poll_repo.recent_polls(limit)]
