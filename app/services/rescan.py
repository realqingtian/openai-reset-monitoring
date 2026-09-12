"""启动回扫：用当前规则重扫保留窗口内的历史推文，补齐命中记录与错过的推送。

命中判定只发生在推文首次入库那一刻，规则调整不会追溯历史；每次启动重扫一遍，
面板命中记录随规则演进自愈。补推送是用户确认的取舍：只补推 24 小时内发布且
从未有过推送尝试的错过公告，更早的只补记录不再推送（避免陈旧告警打扰）；已有
渠道尝试记录的推文仍归每轮轮询开头的补推扫描管，避免重复发送。
"""

import json
import logging
from typing import Any

from app.core.timeutil import hours_ago_iso
from app.repositories import notify_retry
from app.repositories import tweets as tweet_repo
from app.services.matcher import match_text
from app.services.notify import dispatch_hit_dedup

log = logging.getLogger("rescan")

# 补推窗口：发布超过 24 小时的历史帖子不再通知，只补面板命中记录
PUSH_WINDOW_HOURS = 24
# 重扫范围与日志保留期一致（30 天）
SCAN_WINDOW_HOURS = 24 * 30


def _stored_match(tw: dict[str, Any]) -> dict[str, Any]:
    """从库中字段还原匹配结果（与补推扫描的构造方式同构）。"""
    try:
        terms = json.loads(tw["matched_terms"] or "[]")
    except ValueError:
        terms = []
    return {"rule": tw["rule_name"] or "", "terms": terms if isinstance(terms, list) else []}


async def rescan_once(application) -> None:
    """启动时执行一次；与轮询共用 poll_lock 串行，避免与首轮轮询并发推送。"""
    async with application.state.poll_lock:
        cfg = application.state.cfg
        rules = application.state.rules
        try:
            # 1) 未命中的用当前规则重判，命中的补 mark_hit（只补面板记录，不限帖龄）。
            #    复用仓库现成的 tweets_since 读路径，命中/推送候选在 Python 侧分筛：
            #    单账号推文表量级很小，不值得为此加新的 SQL 查询。
            rows = await tweet_repo.tweets_since(hours_ago_iso(SCAN_WINDOW_HOURS))
            rescanned = patched = 0
            for tw in rows:
                if tw["matched"] != 0:
                    continue
                rescanned += 1
                mres = match_text(tw["text"], rules)
                if mres["matched"]:
                    await tweet_repo.mark_hit(tw["id"], mres["rule"], mres["terms"])
                    patched += 1

            # 2) 补推：24 小时内命中但从未推送过的（重取一次以反映步骤 1 的新标记），
            #    按时间升序推送；已有渠道尝试记录的交给既有补推扫描，避免重复发送
            pushed = 0
            attempted = await notify_retry.attempted_tweet_ids()
            fresh = await tweet_repo.tweets_since(hours_ago_iso(PUSH_WINDOW_HOURS))
            for tw in sorted(fresh, key=lambda r: r["created_at"] or ""):
                if tw["matched"] != 1 or tw["notified"] != 0 or tw["id"] in attempted:
                    continue
                if await dispatch_hit_dedup(cfg, application.state.client, tw, _stored_match(tw)):
                    pushed += 1
            log.info("回扫完成：重扫未命中 %d 条，补命中 %d 条，补推 %d 条", rescanned, patched, pushed)
        except Exception as e:
            log.exception(f"回扫任务异常: {e}")
