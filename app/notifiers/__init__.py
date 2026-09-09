"""通知渠道：飞书 / 钉钉 / 企业微信 / Bark / Telegram。命中公告时全渠道并发推送，按推文 ID 与内容指纹双重去重。"""
import logging
from datetime import datetime, timedelta, timezone

import httpx

from app import db
from app.notifiers import bark, dingtalk, feishu, telegram, wecom

log = logging.getLogger("notifiers")

MODULES = {
    "feishu": feishu,
    "dingtalk": dingtalk,
    "wecom": wecom,
    "bark": bark,
    "telegram": telegram,
}


def notifier_states(cfg):
    states = []
    for name, ncfg in (cfg.get("notifiers") or {}).items():
        mod = MODULES.get(name)
        if mod is None:
            continue
        states.append({
            "name": name,
            "enabled": bool(ncfg.get("enabled")),
            "configured": mod.is_configured(ncfg),
        })
    return states


def _fmt_push_times(iso):
    """推文时间（UTC 存储）→ 推送展示用的 UTC 与北京时间（UTC+8）两种年月日时分秒。"""
    dt = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
    utc_s = dt.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    cst_s = dt.astimezone(timezone(timedelta(hours=8))).strftime("%Y-%m-%d %H:%M:%S")
    return utc_s, cst_s


# 推送消息模板（语言由 MONITOR_NOTIFY_LANG 指定，默认中文）
NOTIFY_TEXTS = {
    "zh": {
        "hit_title": "🚨 Codex 重置监控命中",
        "colon": "：",
        "account": "账号", "rule": "命中规则",
        "pub_time": "发布时间", "pub_suffix": "（UTC+0）",
        "cst_time": "发布时间", "cst_suffix": "（UTC+8）",
        "content": "内容", "link": "直达推文",
        "truncated": "…（内容过长已截断）",
        "test_title": "🔔 Codex 重置监控 · 测试消息",
        "test_body": "这是一条测试通知，说明该渠道配置正确。",
    },
    "en": {
        "hit_title": "🚨 Codex Reset Monitor Hit",
        "colon": ": ",
        "account": "Account", "rule": "Matched rule",
        "pub_time": "Published", "pub_suffix": "(UTC+0)",
        "cst_time": "Published", "cst_suffix": "(UTC+8)",
        "content": "Content", "link": "Open tweet",
        "truncated": "… (truncated)",
        "test_title": "🔔 Codex Reset Monitor · Test",
        "test_body": "This is a test notification. The channel is configured correctly.",
    },
}


def _texts(cfg):
    lang = (cfg.get("notify_lang") or "zh").lower()
    return NOTIFY_TEXTS.get(lang, NOTIFY_TEXTS["zh"])


def _hit_message(tweet, mres, texts):
    utc_s, cst_s = _fmt_push_times(tweet["created_at"])
    content = tweet["text"]
    if len(content) > 400:
        content = content[:400].rsplit(" ", 1)[0] + texts["truncated"]
    title = texts["hit_title"]
    c = texts["colon"]
    body = (
        f"{texts['account']}{c}@{tweet['account']}\n"
        f"{texts['rule']}{c}{mres['rule']}\n"
        f"{texts['pub_time']}{c}{utc_s}{texts['pub_suffix']}\n"
        f"{texts['cst_time']}{c}{cst_s}{texts['cst_suffix']}\n"
        f"\n{texts['content']}{c}\n"
        f"{content}\n"
        f"\n{texts['link']}{c}\n"
        f"{tweet['url']}"
    )
    return {"title": title, "body": body, "url": tweet["url"]}


async def _dispatch(cfg, client, msg, tweet_id):
    results = []
    for name, ncfg in (cfg.get("notifiers") or {}).items():
        mod = MODULES.get(name)
        if mod is None or not ncfg.get("enabled") or not mod.is_configured(ncfg):
            continue
        try:
            ok, err = await mod.send(client, ncfg, msg)
        except Exception as e:  # noqa: BLE001 — 单个渠道失败不影响其他渠道
            ok, err = False, f"{type(e).__name__}: {e}"[:200]
        results.append({"channel": name, "ok": bool(ok), "error": err})
        db.log_notify(tweet_id, name, ok, err)
        if not ok:
            log.warning("通知渠道 %s 发送失败: %s", name, err)
    return results


async def dispatch_hit(cfg, client, tweet, mres):
    texts = _texts(cfg)
    return await _dispatch(cfg, client, _hit_message(tweet, mres, texts), tweet["id"])


async def send_test(cfg):
    texts = _texts(cfg)
    msg = {"title": texts["test_title"], "body": texts["test_body"], "url": "https://x.com/thsottiaux"}
    async with httpx.AsyncClient(follow_redirects=True) as client:
        return await _dispatch(cfg, client, msg, "test")
