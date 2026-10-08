"""AI 用例：命中复核 + 翻译。所有失败一律降级（fail-open），绝不阻断轮询与推送主流程。

复核语义：正则命中只是「候选」，AI 判定其是否真是值得推送的重置/订阅公告；
判定为否（miss）时调用方跳过推送，结论落库供面板展示与补推复用。
翻译语义：与 integrations/translate 的返回结构一致（ok/same/text/provider），供链路无缝回退。
"""

import json
import logging
from typing import Any, Optional

from app.core.config import Settings
from app.core.text import normalize_text
from app.integrations import ai as ai_upstream

log = logging.getLogger("ai")

# 复核输出很短；翻译按推文上限放宽
_REVIEW_MAX_TOKENS = 300
_TRANSLATE_MAX_TOKENS = 2000
# reason 落库与展示的上限，防异常输出撑爆版面
_REASON_MAX = 200


def _extract_json(raw: str) -> dict[str, Any]:
    """从模型回复中提取 JSON 对象：容忍 markdown 代码围栏与前后缀闲话。"""
    text = (raw or "").strip()
    if text.startswith("```"):
        text = text.strip("`")
        # 去掉围栏首行的语言标记（如 ```json）
        text = text.split("\n", 1)[1] if "\n" in text else text
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end <= start:
        raise ValueError(f"no json object in reply: {text[:120]}")
    data = json.loads(text[start : end + 1])
    if not isinstance(data, dict):
        raise ValueError("reply is not a json object")
    return data


def _review_system_prompt(reason_lang: str) -> str:
    return (
        "你是 X（Twitter）公告审核器。被监控账号是 Thibault Sottiaux（Tibo，OpenAI Codex 工程负责人），"
        "他偶尔会发布 Codex / ChatGPT 用量重置（reset）、用量限额变化、订阅暂停或恢复的公告。\n"
        "你的任务：判断给出的帖子是否是「值得立即推送通知的公告」。\n"
        "判为公告（hit）：明确宣布用量/限额重置（已发生、正在进行或有明确时间预告）；"
        "宣布订阅暂停、停售、恢复或重开。\n"
        "判为非公告（miss）：日常讨论、技术感想、转发闲聊；"
        "仅泛泛提到 reset 等词但无公告性质（谈历史、谈设想、回答提问）；与重置/订阅无关的内容。\n"
        "只输出一个 JSON 对象，不要输出任何其他文字：\n"
        '{"hit": true, "reason": "<用' + reason_lang + '一句话说明判定依据>"}'
    )


async def review_hit(cfg: Settings, client, text: str, rule: str, terms: list[str]) -> Optional[dict[str, Any]]:
    """AI 复核正则命中。返回 {verdict: "hit"|"miss", reason}；AI 未启用/复核关闭/调用失败返回 None（照常推送）。"""
    ai = cfg.ai
    if not ai.enabled or not ai.review:
        return None
    reason_lang = "English" if cfg.notify_lang == "en" else "中文"
    shown_terms = "、".join(terms) if terms else "（无）"
    user = f"帖子正文：\n{(text or '').strip()}\n\n命中规则：{rule or '（未命名）'}\n命中词：{shown_terms}"
    try:
        raw = await ai_upstream.chat(
            ai, client, _review_system_prompt(reason_lang), user, max_tokens=_REVIEW_MAX_TOKENS
        )
        data = _extract_json(raw)
    except Exception as e:
        # fail-open：复核失败按正则命中继续推送，漏报的代价高于误报
        log.warning("AI 复核失败（按正则命中继续推送）：%s", e)
        return None
    verdict = "hit" if data.get("hit") is True else "miss"
    reason = str(data.get("reason") or "").strip()[:_REASON_MAX]
    return {"verdict": verdict, "reason": reason}


async def translate_text(cfg: Settings, client, text: str, target: str) -> dict[str, Any]:
    """AI 翻译一段文本，返回结构与 integrations/translate.translate_text 一致，便于链路回退。"""
    ai = cfg.ai
    if not ai.enabled:
        return {"ok": False, "error": "ai_disabled"}
    lang_name = "中文" if target.lower().startswith("zh") else "English"
    system = (
        f"你是推文翻译引擎。把用户给出的帖子正文翻译成{lang_name}。要求：\n"
        "- 忠实原意，译文自然口语化，符合社交媒体阅读习惯\n"
        "- @提及、#话题标签、URL、emoji 原样保留\n"
        "- 只输出译文本身，不要任何解释、引号或前后缀\n"
        f"- 若原文已经是{lang_name}，原样输出全文"
    )
    try:
        translated = (
            await ai_upstream.chat(ai, client, system, (text or "").strip(), max_tokens=_TRANSLATE_MAX_TOKENS)
        ).strip()
    except Exception as e:
        log.warning("AI 翻译失败（回退免费通道）：%s", e)
        return {"ok": False, "error": "ai_failed"}
    if not translated:
        return {"ok": False, "error": "empty"}
    if normalize_text(translated) == normalize_text(text):
        return {"ok": True, "same": True, "source": None, "provider": ai.provider}
    return {"ok": True, "same": False, "text": translated, "source": None, "provider": ai.provider}
