"""翻译查询路由。"""

from fastapi import APIRouter, Query, Request

from app.schemas import TranslateOut, UnifiedResponse, ok
from app.services import translate as translate_service

router = APIRouter()


@router.get("/api/translate", response_model=UnifiedResponse[TranslateOut])
async def api_translate(request: Request, id: str = Query(...), to: str = Query(default="zh")):
    """按需翻译推文内容。推文不可变，译文以 (tweet_id, lang) 缓存后永久复用。"""
    return ok(await translate_service.translate_tweet(request.app.state.client, id, to))
