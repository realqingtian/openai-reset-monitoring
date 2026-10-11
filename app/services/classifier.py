"""公告识别共享路径：复用有效 AI 结论 → AI 主判定 → 无有效结论时规则兜底。

轮询与启动回扫共用，判定和命中记录先落库，推送侧只消费结果，避免渠道重试重复调用 AI。
"""

import json
from typing import Any

from app.core.config import Settings
from app.repositories import tweets as tweet_repo
from app.services import ai as ai_service
from app.services.matcher import match_text

AI_RULE_NAME = "AI 判定公告"


async def classify_tweet(cfg: Settings, client, tw: dict[str, Any], rules) -> dict[str, Any]:
    """识别并存储公告结果；有效 miss 不被规则覆盖，AI 失败不缓存为 miss。"""
    verdict = tw.get("ai_verdict")
    if verdict not in ("hit", "miss"):
        review = await ai_service.classify_text(cfg, client, tw.get("text") or "", tw.get("account") or "")
        if review:
            verdict = review["verdict"]
            await tweet_repo.save_ai_review(tw["id"], verdict, review["reason"])
            tw["ai_verdict"], tw["ai_reason"] = verdict, review["reason"]
    if verdict in ("hit", "miss"):
        mres = {"matched": verdict == "hit", "rule": AI_RULE_NAME if verdict == "hit" else None, "terms": []}
    else:
        mres = match_text(tw.get("text") or "", rules)
    if mres["matched"]:
        await tweet_repo.mark_hit(tw["id"], mres["rule"], mres["terms"])
        tw.update(matched=1, rule_name=mres["rule"], matched_terms=json.dumps(mres["terms"], ensure_ascii=False))
    elif verdict == "miss" and tw.get("matched"):
        # 旧版正则候选可能已标命中；主判定确认无关后撤销候选，避免统计或历史显示成真公告。
        await tweet_repo.clear_match(tw["id"])
        tw.update(matched=0, rule_name=None, matched_terms="[]")
    return mres
