"""轮询调度：定时拉取账号时间线 → 去重入库 → 匹配规则 → 命中则全渠道推送。"""
import asyncio
import logging
import time

from app.core.text import content_hash, normalize_text, texts_similar
from app.core.timeutil import hours_ago_iso
from app.repositories import polls as poll_repo
from app.repositories import tweets as tweet_repo
from app.integrations import notifiers
from app.integrations.sources import fetch_with_failover
from app.services.matcher import match_text

log = logging.getLogger("poller")


async def run_poll(app):
    cfg = app.state.cfg
    rules = app.state.rules
    async with app.state.poll_lock:
        for account in cfg.accounts:
            backfill = not await tweet_repo.account_has_tweets(account)
            tweets, used, attempts = await fetch_with_failover(app.state, account, backfill=backfill)
            for a in attempts:
                await poll_repo.log_poll(account, a["source"], a["state"] == "ok",
                                         a.get("count", 0), a.get("error"), a.get("latency_ms"))
            if used is None:
                await poll_repo.log_poll(account, "(all)", False, 0, "所有已启用数据源均失败或未配置", None)
                log.warning("账号 @%s 所有数据源失败或未配置", account)
                continue
            window_start = hours_ago_iso(cfg.lookback_hours)
            new_count = 0
            for tw in tweets:
                tw["account"] = account
                if not await tweet_repo.upsert_tweet(tw):
                    continue
                new_count += 1
                mres = match_text(tw["text"], rules)
                if not mres["matched"]:
                    continue
                await tweet_repo.mark_hit(tw["id"], mres["rule"], mres["terms"])
                # 只对时间窗口内的新推文推送告警，避免首次回填历史时误扰
                if tw["created_at"] >= window_start:
                    chash = content_hash(tw["text"])
                    dup_reason = None
                    if await tweet_repo.hash_already_notified(chash, tw["id"]):
                        # 内容指纹一致：同一公告被重复发布
                        dup_reason = "内容指纹一致"
                    else:
                        # 相似度去重：24 小时内已推送过高度相似的公告（转发/修正版）
                        norm = normalize_text(tw["text"])
                        for rid, rtext in await tweet_repo.notified_texts_since(hours_ago_iso(24)):
                            if texts_similar(norm, normalize_text(rtext)):
                                dup_reason = f"与已推送的 {rid} 高度相似"
                                break
                    if dup_reason:
                        log.info("跳过重复内容推送：id=%s（%s）", tw["id"], dup_reason)
                        await tweet_repo.mark_notified(tw["id"])
                    else:
                        results = await notifiers.dispatch_hit(cfg, app.state.client, tw, mres)
                        if results:
                            await tweet_repo.mark_notified(tw["id"])
            log.info("账号 @%s 检查完成：来源=%s 新推文=%d 总抓取=%d",
                     account, used, new_count, len(tweets))


async def poll_loop(app):
    cfg = app.state.cfg
    interval = max(1, int(cfg.poll_interval_minutes)) * 60
    while True:
        t0 = time.monotonic()
        try:
            await run_poll(app)
        except Exception as e:  # noqa: BLE001 — 保证轮询循环永不退出
            log.exception(f"轮询任务异常: {e}")
        sleep_s = max(30, interval - (time.monotonic() - t0))
        await asyncio.sleep(sleep_s)
