"""轮询调度：定时拉取账号时间线 → 去重入库 → 匹配规则 → 命中则全渠道推送。"""
import asyncio
import logging
import time

from app import db, notifiers
from app.matcher import match_text
from app.sources import fetch_with_failover
from app.util import content_hash, hours_ago_iso, normalize_text, texts_similar

log = logging.getLogger("poller")


async def run_poll(app):
    cfg = app.state.cfg
    rules = app.state.rules
    async with app.state.poll_lock:
        for account in cfg["accounts"]:
            backfill = not db.account_has_tweets(account)
            tweets, used, attempts = await fetch_with_failover(app.state, account, backfill=backfill)
            for a in attempts:
                db.log_poll(account, a["source"], a["state"] == "ok",
                            a.get("count", 0), a.get("error"), a.get("latency_ms"))
            if used is None:
                db.log_poll(account, "(all)", False, 0, "所有已启用数据源均失败或未配置", None)
                log.warning("账号 @%s 所有数据源失败或未配置", account)
                continue
            window_start = hours_ago_iso(cfg["lookback_hours"])
            new_count = 0
            for tw in tweets:
                tw["account"] = account
                if not db.upsert_tweet(tw):
                    continue
                new_count += 1
                mres = match_text(tw["text"], rules)
                if not mres["matched"]:
                    continue
                db.mark_hit(tw["id"], mres["rule"], mres["terms"])
                # 只对时间窗口内的新推文推送告警，避免首次回填历史时误扰
                if tw["created_at"] >= window_start:
                    chash = content_hash(tw["text"])
                    dup_reason = None
                    if db.hash_already_notified(chash, tw["id"]):
                        # 内容指纹一致：同一公告被重复发布
                        dup_reason = "内容指纹一致"
                    else:
                        # 相似度去重：24 小时内已推送过高度相似的公告（转发/修正版）
                        norm = normalize_text(tw["text"])
                        for rid, rtext in db.notified_texts_since(hours_ago_iso(24)):
                            if texts_similar(norm, normalize_text(rtext)):
                                dup_reason = f"与已推送的 {rid} 高度相似"
                                break
                    if dup_reason:
                        log.info("跳过重复内容推送：id=%s（%s）", tw["id"], dup_reason)
                        db.mark_notified(tw["id"])
                    else:
                        results = await notifiers.dispatch_hit(cfg, app.state.client, tw, mres)
                        if results:
                            db.mark_notified(tw["id"])
            log.info("账号 @%s 检查完成：来源=%s 新推文=%d 总抓取=%d",
                     account, used, new_count, len(tweets))


async def poll_loop(app):
    cfg = app.state.cfg
    interval = max(1, int(cfg.get("poll_interval_minutes", 5))) * 60
    while True:
        t0 = time.monotonic()
        try:
            await run_poll(app)
        except Exception:  # noqa: BLE001 — 保证轮询循环永不退出
            log.exception("轮询任务异常")
        sleep_s = max(30, interval - (time.monotonic() - t0))
        await asyncio.sleep(sleep_s)
