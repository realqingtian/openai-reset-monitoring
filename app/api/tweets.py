"""推文查询路由。"""

from fastapi import APIRouter, Query, Request

from app.schemas import TweetOut, UnifiedResponse, ok
from app.services import tweets as tweet_service

router = APIRouter()


@router.get("/api/tweets", response_model=UnifiedResponse[list[TweetOut]])
async def api_tweets(request: Request, hours: float = Query(default=None, gt=0, le=720)):
    return ok(await tweet_service.list_tweets(hours, request.app.state.cfg))


@router.get("/api/hits", response_model=UnifiedResponse[list[TweetOut]])
async def api_hits(limit: int = Query(default=100, gt=0, le=500)):
    return ok(await tweet_service.list_hits(limit))
