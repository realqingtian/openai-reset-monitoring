"""帖子列表 / 命中历史查询。"""

from typing import Optional

from app.core.config import Settings
from app.core.timeutil import hours_ago_iso
from app.repositories import tweets as tweet_repo
from app.schemas import TweetOut
from app.schemas.event import EventKind, EventPhase
from app.services import account_meta, events


async def _page(
    cfg: Optional[Settings],
    limit: Optional[int],
    before: Optional[str],
    since: Optional[str],
    matched: bool,
    kind: Optional[EventKind],
    phase: Optional[EventPhase],
    account: Optional[str],
) -> list[TweetOut]:
    if kind is not None or phase is not None or account is not None:
        # 先对完整可见数据分类，再把命中的主键交给数据库分页，不能在一页里筛到空就停止。
        visible = await tweet_repo.tweet_page(None, None, since=since, matched=matched)
        metadata = await events.annotations(visible, cfg)
        identifiers = [
            row["id"]
            for row in visible
            if (kind is None or metadata[row["id"]]["kind"] == kind)
            and (phase is None or metadata[row["id"]]["phase"] == phase)
            and (account is None or row["account"] == account)
        ]
        rows = await tweet_repo.tweet_page(limit, before, since=since, matched=matched, identifiers=identifiers)
    else:
        rows = await tweet_repo.tweet_page(limit, before, since=since, matched=matched)
        metadata = await events.annotations(rows, cfg)
    dtos = [
        TweetOut.model_validate({**row, "kind": metadata[row["id"]]["kind"], "phase": metadata[row["id"]]["phase"]})
        for row in rows
    ]
    await account_meta.enrich_tweets(dtos)
    return dtos


async def list_tweets(
    hours: Optional[float],
    cfg: Settings,
    limit: Optional[int] = None,
    before: Optional[str] = None,
    kind: Optional[EventKind] = None,
    phase: Optional[EventPhase] = None,
    account: Optional[str] = None,
) -> list[TweetOut]:
    """时间窗口内的推文 DTO 列表；hours 为空时用配置的回看窗口。"""
    since = hours_ago_iso(hours if hours is not None else cfg.lookback_hours)
    return await _page(cfg, limit, before, since, False, kind, phase, account)


async def list_hits(
    limit: int,
    before: Optional[str] = None,
    cfg: Optional[Settings] = None,
    kind: Optional[EventKind] = None,
    phase: Optional[EventPhase] = None,
    account: Optional[str] = None,
) -> list[TweetOut]:
    """历史命中 DTO 列表（按发布时间倒序截断）。"""
    return await _page(cfg, limit, before, None, True, kind, phase, account)
