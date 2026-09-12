"""通知用例：调试环境的测试通知 + 命中推送（带内容去重）的共享路径。"""

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

log = logging.getLogger("notify")


async def test_notify(cfg: Settings) -> list[TestNotifyResult]:
    # 生产环境直接拒绝，防止误触发真实渠道推送
    if not cfg.debug:
        raise BizError(403, "测试通知仅在 MONITOR_ENV=debug 调试环境下可用")
    return [TestNotifyResult.model_validate(r) for r in await send_test(cfg)]


async def dispatch_hit_dedup(
    cfg: Settings, client: httpx.AsyncClient, tw: dict[str, Any], mres: dict[str, Any]
) -> bool:
    """带内容去重的命中推送，轮询入库与启动回扫共用。

    与已推送内容指纹一致或高度相似（转发/修正版）视为重复：不推送，仅标记已推送；
    否则全渠道推送，全部成功才标记已推送，部分失败留给每轮轮询开头的补推扫描。
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
    results = await dispatch_hit(cfg, client, tw, mres)
    if results and all(r["ok"] for r in results):
        await tweet_repo.mark_notified(tw["id"])
    return True
