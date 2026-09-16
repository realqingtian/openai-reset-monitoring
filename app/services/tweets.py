"""帖子列表 / 命中历史查询。"""

from typing import Optional

from app.core.config import Settings
from app.core.timeutil import hours_ago_iso
from app.repositories import tweets as tweet_repo
from app.schemas import TweetOut
from app.services import account_meta


async def list_tweets(hours: Optional[float], cfg: Settings) -> list[TweetOut]:
    """时间窗口内的推文 DTO 列表；hours 为空时用配置的回看窗口。"""
    since = hours_ago_iso(hours if hours is not None else cfg.lookback_hours)
    dtos = [TweetOut.model_validate(t) for t in await tweet_repo.tweets_since(since)]
    await account_meta.enrich_tweets(dtos)
    return dtos


async def list_hits(limit: int) -> list[TweetOut]:
    """历史命中 DTO 列表（按发布时间倒序截断）。"""
    dtos = [TweetOut.model_validate(t) for t in await tweet_repo.matched_tweets(limit)]
    await account_meta.enrich_tweets(dtos)
    return dtos
