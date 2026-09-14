"""轮询调度：定时拉取账号时间线 → 去重入库 → 匹配规则 → 命中则全渠道推送；
渠道失败的命中由每轮开头的补推扫描按渠道重发（成功渠道不重发）。
每轮结束后交由 source_watch 评估数据源健康（连续失败自告警）。"""

import asyncio
import json
import logging
import time

from app.core.timeutil import hours_ago_iso
from app.integrations import notifiers
from app.integrations.sources import fetch_with_failover
from app.repositories import notify_retry
from app.repositories import polls as poll_repo
from app.repositories import tweets as tweet_repo
from app.services import source_watch
from app.services.matcher import match_text
from app.services.notify import dispatch_hit_dedup

log = logging.getLogger("poller")


async def _retry_failed_pushes(app):
    """补推扫描：窗口内命中但未全部送达的推文，只向最近一次失败的渠道重发。

    成功过的渠道不重发，避免重复打扰；失败渠道后来被停用/解配置时视为完成，
    防止候选被无限扫描。命中时未配置任何渠道的推文没有尝试记录，不参与补推。
    """
    cfg = app.state.cfg
    window_start = hours_ago_iso(cfg.lookback_hours)
    attempted = await notify_retry.attempted_tweet_ids()
    for tw in await notify_retry.retry_candidates(window_start, attempted):
        failed = [ch for ch, ok in (await notify_retry.latest_channel_results(tw["id"])).items() if not ok]
        if not failed:
            await tweet_repo.mark_notified(tw["id"])
            continue
        try:
            terms = json.loads(tw["matched_terms"] or "[]")
        except ValueError:
            terms = []
        mres = {"rule": tw["rule_name"] or "", "terms": terms if isinstance(terms, list) else []}
        results = await notifiers.dispatch_hit(cfg, app.state.client, tw, mres, only_channels=failed)
        if not results or all(r["ok"] for r in results):
            await tweet_repo.mark_notified(tw["id"])


async def run_poll(app) -> dict:
    """执行一轮全部账号的检查，返回健康摘要供 source_watch 判定。

    ok=True 要求所有「实际发起了数据源请求」的账号都成功；没配置任何源的账号
    不参与判定（空跑不是故障）。手动 /api/poll-now 也走这里，但其返回值不进入
    自监控计数——只有 poll_loop 里的定时轮询才调用 observe。
    """
    cfg = app.state.cfg
    rules = app.state.rules
    summary: dict = {"ok": True, "accounts": list(cfg.accounts), "failed_accounts": [], "errors": []}
    async with app.state.poll_lock:
        await _retry_failed_pushes(app)
        for account in cfg.accounts:
            backfill = not await tweet_repo.account_has_tweets(account)
            tweets, used, attempts = await fetch_with_failover(app.state, account, backfill=backfill)
            for a in attempts:
                await poll_repo.log_poll(
                    account, a["source"], a["state"] == "ok", a.get("count", 0), a.get("error"), a.get("latency_ms")
                )
            if used is None:
                await poll_repo.log_poll(account, "(all)", False, 0, "所有已启用数据源均失败或未配置", None)
                # attempts 非空说明源已配置且确实尝试过——真失败；为空说明压根没配置，不算
                if attempts:
                    summary["failed_accounts"].append(account)
                    summary["errors"].extend(a["error"] for a in attempts if a.get("error"))
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
                    await dispatch_hit_dedup(cfg, app.state.client, tw, mres)
            log.info("账号 @%s 检查完成：来源=%s 新推文=%d 总抓取=%d", account, used, new_count, len(tweets))
    if summary["failed_accounts"]:
        summary["ok"] = False
        summary["errors"] = summary["errors"][:5]
    return summary


async def poll_loop(app):
    cfg = app.state.cfg
    interval = max(1, int(cfg.poll_interval_minutes)) * 60
    while True:
        t0 = time.monotonic()
        result: dict = {"ok": True, "accounts": list(cfg.accounts)}
        try:
            result = await run_poll(app)
        except Exception as e:
            # 轮询任务本身抛异常（如数据库故障）同样视为一轮失败，交给自监控计数
            log.exception(f"轮询任务异常: {e}")
            result = {
                "ok": False,
                "accounts": list(cfg.accounts),
                "failed_accounts": list(cfg.accounts),
                "errors": [f"{type(e).__name__}: {e}"],
            }
        try:
            await source_watch.observe(cfg, app.state.client, result)
        except Exception:
            log.exception("数据源自监控评估异常")
        sleep_s = max(30, interval - (time.monotonic() - t0))
        await asyncio.sleep(sleep_s)
