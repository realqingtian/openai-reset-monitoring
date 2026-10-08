"""通知用例：调试环境的测试通知 + 命中推送（内容去重 + AI 复核 + 附译文）的共享路径。"""

import logging
from typing import Any, Optional

import httpx

from app.core.config import Settings
from app.core.errors import BizError
from app.core.text import content_hash, normalize_text, texts_similar
from app.core.timeutil import hours_ago_iso
from app.integrations.notifiers import dispatch_hit, send_test
from app.repositories import tweets as tweet_repo
from app.schemas import TestNotifyResult
from app.services import account_meta
from app.services import ai as ai_service
from app.services.translate import translation_for_push

log = logging.getLogger("notify")


async def test_notify(cfg: Settings) -> list[TestNotifyResult]:
    # 生产环境直接拒绝，防止误触发真实渠道推送
    if not cfg.debug:
        raise BizError(403, "测试通知仅在 MONITOR_ENV=debug 调试环境下可用")
    return [TestNotifyResult.model_validate(r) for r in await send_test(cfg)]


async def push_extra(cfg: Settings, client: httpx.AsyncClient, tw: dict[str, Any]) -> dict[str, Any]:
    """组装推送附件信息：作者昵称 / AI 复核结论 / 译文。各项独立降级，失败只省略对应块。"""
    extra: dict[str, Any] = {
        "author_name": None,
        "ai_verdict": tw.get("ai_verdict"),
        "ai_reason": tw.get("ai_reason"),
        "translation": None,
    }
    try:
        meta = (await account_meta.all_meta()).get(tw.get("account") or "") or {}
        extra["author_name"] = (meta.get("name") or "").strip() or None
    except Exception:
        pass  # 昵称只是装饰性信息，取不到直接省略
    extra["translation"] = await translation_for_push(cfg, client, tw["id"], tw.get("text") or "")
    return extra


async def dispatch_hit_dedup(
    cfg: Settings, client: httpx.AsyncClient, tw: dict[str, Any], mres: dict[str, Any]
) -> bool:
    """带内容去重与 AI 复核的命中推送，轮询入库与启动回扫共用。

    流程：内容去重（同指纹/高度相似视为重复）→ AI 复核（排除正则误报，结论落库）→
    附译文全渠道推送，全部成功才标记已推送，部分失败留给每轮轮询开头的补推扫描。
    返回是否实际发起了推送。
    """
    dup_reason: Optional[str] = None
    if await tweet_repo.hash_already_notified(content_hash(tw["text"]), tw["id"]):
        dup_reason = "内容指纹一致"
    else:
        norm = normalize_text(tw["text"])
        for rid, rtext in await tweet_repo.notified_texts_since(hours_ago_iso(24)):
            if texts_similar(norm, normalize_text(rtext)):
                dup_reason = f"与已推送的 {rid} 高度相似"
                break
    if dup_reason:
        log.info("跳过重复内容推送：id=%s（%s）", tw["id"], dup_reason)
        await tweet_repo.mark_notified(tw["id"])
        return False
    # AI 复核放在去重之后：重复内容本就不会推送，不为它花 token。
    # 结论每帖只落库一次（补推扫描据此免二次调用）；判定无关则不推送也不标已推送，
    # 面板以「AI 判定无关」徽章说明为什么不推。
    if not tw.get("ai_verdict"):
        review = await ai_service.review_hit(
            cfg, client, tw.get("text") or "", mres.get("rule") or "", mres.get("terms") or []
        )
        if review:
            await tweet_repo.save_ai_review(tw["id"], review["verdict"], review["reason"])
            tw["ai_verdict"], tw["ai_reason"] = review["verdict"], review["reason"]
            if review["verdict"] == "miss":
                log.info("AI 复核判定与重置无关，跳过推送：id=%s（%s）", tw["id"], review["reason"])
                return False
    results = await dispatch_hit(cfg, client, tw, mres, extra=await push_extra(cfg, client, tw))
    if results and all(r["ok"] for r in results):
        await tweet_repo.mark_notified(tw["id"])
    return True
