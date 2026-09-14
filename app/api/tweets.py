"""推文查询路由。"""

from typing import Optional

from fastapi import APIRouter, Depends, Query, Request

from app.core.security import optional_login
from app.schemas import TweetOut, UnifiedResponse, ok
from app.services import tweets as tweet_service

router = APIRouter()


@router.get("/api/tweets", response_model=UnifiedResponse[list[TweetOut]])
async def api_tweets(
    request: Request,
    hours: float = Query(default=None, gt=0, le=720),
    user: Optional[str] = Depends(optional_login),
):
    # 匿名只读口径：未登录最多看 24 小时窗口，传更大的 hours 也按 24 钳制；登录后按配置与参数放宽
    cfg = request.app.state.cfg
    if user is None:
        hours = min(hours if hours is not None else cfg.lookback_hours, 24.0)
    return ok(await tweet_service.list_tweets(hours, cfg))


@router.get("/api/hits", response_model=UnifiedResponse[list[TweetOut]])
async def api_hits(limit: int = Query(default=100, gt=0, le=500)):
    return ok(await tweet_service.list_hits(limit))
