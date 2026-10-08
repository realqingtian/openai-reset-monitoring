"""帖子按需翻译用例：语言白名单 → 译文缓存 → AI 优先翻译（失败回退免费通道）。"""

import logging
from typing import Optional

from app.core.config import Settings
from app.core.errors import BizError
from app.core.text import looks_like_lang
from app.integrations import translate as translate_upstream
from app.integrations.ai import is_ai_provider
from app.repositories import translations as translations_repo
from app.repositories import tweets as tweet_repo
from app.schemas import TranslateOut
from app.services import ai as ai_service

log = logging.getLogger("translate")

# 目标语言白名单：zh→zh-CN，en→en，其余拒绝
LANG_MAP = {"zh": "zh-CN", "en": "en"}


async def translate_tweet(cfg: Settings, client, tweet_id: str, to: str) -> TranslateOut:
    """翻译指定推文。client 为共享的 httpx.AsyncClient（由调用方持有）。"""
    lang = LANG_MAP.get((to or "").lower())
    if not lang:
        raise BizError(400, "不支持的目标语言")
    row = await tweet_repo.get_tweet(tweet_id)
    if not row or not (row.get("text") or "").strip():
        raise BizError(404, "帖子不存在或内容为空")
    cached = await translations_repo.get_translation(tweet_id, lang)
    if cached:
        provider = cached["provider"] or ""
        return TranslateOut(
            id=tweet_id, to=lang, text=cached["text"], provider=provider, cached=True, ai=is_ai_provider(provider)
        )
    # AI 优先：译文更自然；未配置 AI 或 AI 失败时回退免费通道（Google → MyMemory）
    result = await ai_service.translate_text(cfg, client, row["text"], lang)
    if not result.get("ok"):
        result = await translate_upstream.translate_text(client, row["text"], target=lang)
    if not result.get("ok"):
        raise BizError(502, "翻译服务调用失败", errors=[result.get("error", "translate_failed")])
    if result.get("same"):
        return TranslateOut(id=tweet_id, to=lang, same=True, source=result.get("source"))
    provider = result.get("provider") or ""
    await translations_repo.save_translation(tweet_id, lang, result["text"], provider)
    return TranslateOut(
        id=tweet_id, to=lang, text=result["text"], provider=provider, cached=False, ai=is_ai_provider(provider)
    )


async def translation_for_push(cfg: Settings, client, tweet_id: str, text: str) -> Optional[str]:
    """推送附带的译文：原文已是推送语言则免翻；任何失败降级为 None（推送省略译文块）。

    与面板翻译共用 (tweet_id, lang) 缓存，推送取过的译文面板直接复用。
    """
    target = cfg.notify_lang
    if (text or "").strip() and not looks_like_lang(text, target):
        try:
            out = await translate_tweet(cfg, client, tweet_id, target)
            return out.text or None
        except Exception as e:
            log.warning("推送译文获取失败（推送省略译文块）：%s", e)
    return None
