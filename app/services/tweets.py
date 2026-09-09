"""帖子列表 / 命中历史查询。"""
from typing import List, Optional

from app.schemas import TweetOut
from app.core.config import Settings
from app.core.timeutil import hours_ago_iso
from app.repositories import tweets as tweet_repo


async def list_tweets(hours: Optional[float], cfg: Settings) -> List[TweetOut]:
    """时间窗口内的推文 DTO 列表；hours 为空时用配置的回看窗口。"""
    since = hours_ago_iso(hours if hours is not None else cfg.lookback_hours)
    return [TweetOut.model_validate(t) for t in await tweet_repo.tweets_since(since)]


async def list_hits(limit: int) -> List[TweetOut]:
    """历史命中 DTO 列表（按发布时间倒序截断）。"""
    return [TweetOut.model_validate(t) for t in await tweet_repo.matched_tweets(limit)]
