"""通知渠道：飞书 / 钉钉 / 企业微信 / Bark / Telegram。命中公告时全渠道并发推送，按推文 ID 与内容指纹双重去重。"""

import logging
from datetime import datetime, timedelta, timezone

import httpx

from app.repositories import notifies as notify_repo

from . import bark, dingtalk, feishu, telegram, wecom

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
    for name in ("feishu", "dingtalk", "wecom", "bark", "telegram"):
        ncfg = getattr(cfg.notifiers, name)
        mod = MODULES.get(name)
        if mod is None:
            continue
        states.append(
            {
                "name": name,
                "enabled": ncfg.enabled,
                "configured": mod.is_configured(ncfg),
            }
        )
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
        "account": "👤 账号",
        "open_paren": "（",
        "close_paren": "）",
        "pub_time": "🕐 发布时间",
        "cst_suffix": "（UTC+8）",
        "utc_suffix": "（UTC+0）",
        "time_join": " ｜ ",
        "content": "💬 原文",
        "translation": "🌐 译文",
        "rule": "🏷 命中规则",
        "terms_join": "、",
        "ai_review": "🤖 AI 复核",
        "link": "🔗 直达推文",
        "truncated": "…（内容过长已截断）",
        "test_title": "🔔 Codex 重置监控 · 测试消息",
        "test_body": "这是一条测试通知，说明该渠道配置正确。",
        "src_alert_title": "⚠️ Codex 重置监控 · 数据源异常",
        "src_recover_title": "✅ Codex 重置监控 · 数据源恢复",
        "src_accounts": "账号",
        "src_consecutive": "连续失败",
        "src_cycles": " 轮",
        "src_since": "自",
        "src_last_error": "最后错误",
        "src_down_for": "本次故障持续约",
        "src_recovered": "已恢复正常轮询，命中推送不受影响。",
        "src_panel": "面板",
    },
    "en": {
        "hit_title": "🚨 Codex Reset Monitor Hit",
        "colon": ": ",
        "account": "👤 Account",
        "open_paren": " (",
        "close_paren": ")",
        "pub_time": "🕐 Published",
        "cst_suffix": " (UTC+8)",
        "utc_suffix": " (UTC+0)",
        "time_join": " | ",
        "content": "💬 Original",
        "translation": "🌐 Translation",
        "rule": "🏷 Matched rule",
        "terms_join": ", ",
        "ai_review": "🤖 AI review",
        "link": "🔗 Open tweet",
        "truncated": "… (truncated)",
        "test_title": "🔔 Codex Reset Monitor · Test",
        "test_body": "This is a test notification. The channel is configured correctly.",
        "src_alert_title": "⚠️ Codex Reset Monitor · Source Down",
        "src_recover_title": "✅ Codex Reset Monitor · Source Recovered",
        "src_accounts": "Accounts",
        "src_consecutive": "Consecutive failed cycles",
        "src_cycles": "",
        "src_since": "Failing since",
        "src_last_error": "Last error",
        "src_down_for": "Downtime lasted about",
        "src_recovered": "Polling is healthy again; hit pushes are unaffected.",
        "src_panel": "Panel",
    },
}


def _texts(cfg):
    lang = (cfg.notify_lang or "zh").lower()
    return NOTIFY_TEXTS.get(lang, NOTIFY_TEXTS["zh"])


def _clip(text, limit, suffix):
    """正文超长截断：优先在词边界（空格）处收刀，中文无空格则按硬长度切。"""
    text = text or ""
    if len(text) <= limit:
        return text
    cut = text[:limit].rsplit(" ", 1)[0]
    return (cut if len(cut) > limit // 2 else text[:limit]) + suffix


def _hit_message(tweet, mres, texts, extra=None):
    """命中公告消息：账号 → 双时区时间 → 原文 → 译文（有则附）→ 命中规则与命中词 → AI 结论 → 链接。

    extra: {author_name, ai_verdict, ai_reason, translation}，由通知用例层组装，各项可缺省。
    """
    extra = extra or {}
    utc_s, cst_s = _fmt_push_times(tweet["created_at"])
    c = texts["colon"]
    who = "@" + str(tweet.get("account") or "")
    author = (extra.get("author_name") or "").strip()
    if author:
        who += f"{texts['open_paren']}{author}{texts['close_paren']}"
    lines = [
        f"{texts['account']}{c}{who}",
        f"{texts['pub_time']}{c}{cst_s}{texts['cst_suffix']}{texts['time_join']}{utc_s}{texts['utc_suffix']}",
        "",
        f"{texts['content']}{c}",
        _clip(tweet["text"], 400, texts["truncated"]),
    ]
    translation = (extra.get("translation") or "").strip()
    if translation:
        lines += ["", f"{texts['translation']}{c}", _clip(translation, 400, texts["truncated"])]
    terms = [str(t) for t in (mres.get("terms") or []) if str(t).strip()]
    rule_line = f"{texts['rule']}{c}{mres.get('rule') or ''}"
    if terms:
        rule_line += f"{texts['open_paren']}{texts['terms_join'].join(terms)}{texts['close_paren']}"
    lines += ["", rule_line]
    # 只有 AI 确认的公告才会走到推送（判定无关在用例层已被拦下），这里展示复核依据
    if extra.get("ai_verdict") == "hit" and (extra.get("ai_reason") or "").strip():
        lines.append(f"{texts['ai_review']}{c}{str(extra['ai_reason']).strip()}")
    lines += ["", f"{texts['link']}{c}", tweet["url"]]
    return {"title": texts["hit_title"], "body": "\n".join(lines), "url": tweet["url"]}


async def _dispatch(cfg, client, msg, tweet_id, only_channels=None):
    # DEMO 模式只隔离数据库，这里补上通知隔离：演示命中绝不能进用户真实群聊。
    # 返回空列表使命中保持未推送状态，面板展示符合事实。
    if getattr(cfg, "demo", False):
        log.info("DEMO 模式：跳过真实渠道推送（%s）", msg["title"])
        return []
    results = []
    channels = only_channels or ("feishu", "dingtalk", "wecom", "bark", "telegram")
    for name in channels:
        ncfg = getattr(cfg.notifiers, name)
        mod = MODULES.get(name)
        if mod is None or not ncfg.enabled or not mod.is_configured(ncfg):
            continue
        try:
            ok, err = await mod.send(client, ncfg, msg)
        except Exception as e:
            ok, err = False, f"{type(e).__name__}: {e}"[:200]
        results.append({"channel": name, "ok": bool(ok), "error": err})
        await notify_repo.log_notify(tweet_id, name, ok, err)
        if not ok:
            log.warning("通知渠道 %s 发送失败: %s", name, err)
    return results


async def dispatch_hit(cfg, client, tweet, mres, only_channels=None, extra=None):
    """推送命中公告。only_channels 供补推使用：只重发指定（上次失败的）渠道；
    extra 携带译文 / AI 复核结论 / 作者昵称，缺省时渲染不含附加块的模板。"""
    texts = _texts(cfg)
    return await _dispatch(cfg, client, _hit_message(tweet, mres, texts, extra), tweet["id"], only_channels)


def _fmt_duration(hours: float, texts) -> str:
    """故障时长的人类可读描述（告警/恢复消息共用）。"""
    if hours >= 1:
        return f"约 {hours:.1f} 小时" if texts is NOTIFY_TEXTS["zh"] else f"~{hours:.1f} h"
    return f"约 {max(1, int(hours * 60))} 分钟" if texts is NOTIFY_TEXTS["zh"] else f"~{max(1, int(hours * 60))} min"


def _alert_message(kind, detail, texts):
    """数据源自告警消息。detail: {accounts, consecutive, since_iso, hours_down, last_error}。"""
    title = texts["src_alert_title"] if kind == "alert" else texts["src_recover_title"]
    c = texts["colon"]
    accs = (
        "、".join("@" + a for a in detail["accounts"])
        if texts is NOTIFY_TEXTS["zh"]
        else ", ".join("@" + a for a in detail["accounts"])
    )
    lines = [f"{texts['src_accounts']}{c}{accs}"]
    if kind == "alert":
        lines.append(f"{texts['src_consecutive']}{c}{detail['consecutive']}{texts['src_cycles']}")
        if detail.get("since_iso"):
            lines.append(f"{texts['src_since']}{c}{detail['since_iso']}")
        if detail.get("last_error"):
            lines.append(f"{texts['src_last_error']}{c}{detail['last_error']}")
    else:
        lines.append(f"{texts['src_down_for']}{c}{_fmt_duration(detail.get('hours_down') or 0, texts)}")
        lines.append(texts["src_recovered"])
    if detail.get("panel_url"):
        lines.append(f"\n{texts['src_panel']}{c}{detail['panel_url']}")
    return {"title": title, "body": "\n".join(lines), "url": detail.get("panel_url") or ""}


async def send_alert(cfg, client, kind: str, detail: dict):
    """推送数据源故障 / 恢复告警。kind: "alert" | "recover"。

    与命中推送共用渠道发送与日志落库（tweet_id 用 source-alert-* 标记），
    但不走命中补推扫描：告警自带重发节奏（MONITOR_SOURCE_ALERT_REPEAT_MINUTES）。
    """
    texts = _texts(cfg)
    msg = _alert_message(kind, detail, texts)
    return await _dispatch(cfg, client, msg, f"source-alert-{kind}")


async def send_test(cfg):
    texts = _texts(cfg)
    msg = {"title": texts["test_title"], "body": texts["test_body"], "url": "https://x.com/thsottiaux"}
    async with httpx.AsyncClient(follow_redirects=True) as client:
        return await _dispatch(cfg, client, msg, "test")
