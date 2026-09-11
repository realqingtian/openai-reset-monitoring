"""帖子按需翻译用例：语言白名单 → 译文缓存 → 上游翻译。"""

from app.core.errors import BizError
from app.integrations import translate as translate_upstream
from app.repositories import translations as translations_repo
from app.repositories import tweets as tweet_repo
from app.schemas import TranslateOut

# 目标语言白名单：zh→zh-CN，en→en，其余拒绝
LANG_MAP = {"zh": "zh-CN", "en": "en"}


async def translate_tweet(client, tweet_id: str, to: str) -> TranslateOut:
    """翻译指定推文。client 为共享的 httpx.AsyncClient（由调用方持有）。"""
    lang = LANG_MAP.get((to or "").lower())
    if not lang:
        raise BizError(400, "不支持的目标语言")
    row = await tweet_repo.get_tweet(tweet_id)
    if not row or not (row.get("text") or "").strip():
        raise BizError(404, "帖子不存在或内容为空")
    cached = await translations_repo.get_translation(tweet_id, lang)
    if cached:
        return TranslateOut(id=tweet_id, to=lang, text=cached["text"], provider=cached["provider"] or "", cached=True)
    result = await translate_upstream.translate_text(client, row["text"], target=lang)
    if not result.get("ok"):
        raise BizError(502, "翻译服务调用失败", errors=[result.get("error", "translate_failed")])
    if result.get("same"):
        return TranslateOut(id=tweet_id, to=lang, same=True, source=result.get("source"))
    await translations_repo.save_translation(tweet_id, lang, result["text"], result.get("provider") or "")
    return TranslateOut(id=tweet_id, to=lang, text=result["text"], provider=result.get("provider") or "", cached=False)
