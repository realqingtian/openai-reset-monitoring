"""配置加载：全部来自环境变量 / 项目根目录的 .env 文件。

优先级：OS 环境变量 > .env 文件 > 内置默认值。
约定：数据源与通知渠道"填了凭证即启用，留空即停用"。
"""
import json
import logging
import os
from pathlib import Path

try:
    from dotenv import load_dotenv
except ImportError:  # 允许未安装 python-dotenv：此时只读 OS 环境变量
    load_dotenv = None

ROOT = Path(__file__).resolve().parent.parent
log = logging.getLogger("config")

# 内置命中规则：依据 Tibo 的历史措辞设计（同一条规则内所有正则全部命中才触发）。
# 如需自定义，设置环境变量 MONITOR_RULES_JSON（结构与此处一致）覆盖。
DEFAULT_RULES = [
    {
        "name": "全球重置·英文",
        "enabled": True,
        "all_patterns": [
            r"reset(?:ted|ting|s)?\b",
            r"(?:usage|rate)[ _-]?limits?|\busages?\b",
            r"\b(?:paid|paying|subscri\w*|everyone|all|global\w*|codex|chatgpt|we|our)\b",
        ],
    },
    {
        "name": "全球重置·中文",
        "enabled": True,
        "all_patterns": [
            r"重置",
            r"用量|限额|额度|付费|订阅|全球",
        ],
    },
    {
        # 宽松兜底：如 "I will reset usage limits this evening"（预告式，无受众词）
        "name": "全球重置·英文·宽",
        "enabled": True,
        "all_patterns": [
            r"reset(?:ted|ting|s)?\b",
            r"(?:usage|rate)[ _-]?limits?",
        ],
    },
]


def _env(name, default=""):
    v = os.environ.get(name)
    if v is None or v.strip() == "":
        return default
    return v.strip()


def _int_env(name, default):
    try:
        return max(1, int(float(_env(name, str(default)))))
    except (TypeError, ValueError):
        log.warning("环境变量 %s 不是合法数字，使用默认值 %s", name, default)
        return default


def _rules():
    raw = _env("MONITOR_RULES_JSON")
    if not raw:
        return [dict(r) for r in DEFAULT_RULES]
    try:
        rules = json.loads(raw)
        if not isinstance(rules, list) or not rules:
            raise ValueError("必须是非空数组")
        return rules
    except (ValueError, TypeError) as e:
        log.warning("MONITOR_RULES_JSON 解析失败（%s），使用内置默认规则", e)
        return [dict(r) for r in DEFAULT_RULES]


def load_config():
    if load_dotenv:
        # 不覆盖已存在的 OS 环境变量
        load_dotenv(ROOT / ".env")

    # 运行环境：production（默认）/ debug（dev/development 视为 debug）
    env_mode = _env("MONITOR_ENV", "production").lower()
    if env_mode in ("debug", "dev", "development"):
        env_mode = "debug"
    else:
        env_mode = "production"

    # 推送消息模板语言：zh（默认）/ en
    notify_lang = _env("MONITOR_NOTIFY_LANG", "zh").lower()
    if notify_lang not in ("zh", "en"):
        notify_lang = "zh"

    return {
        "env_mode": env_mode,
        # 面板页面标题与导航栏名称
        "site_name": _env("MONITOR_SITE_NAME", "Codex Reset Monitor"),
        "service": {
            "host": _env("MONITOR_HOST", "127.0.0.1"),
            "port": _int_env("MONITOR_PORT", 8730),
        },
        # 监控的 X 账号，逗号分隔，自动去掉 @ 前缀
        "accounts": [
            a.strip().lstrip("@")
            for a in _env("MONITOR_ACCOUNTS", "thsottiaux").split(",")
            if a.strip()
        ]
        or ["thsottiaux"],
        "poll_interval_minutes": _int_env("MONITOR_POLL_INTERVAL", 5),
        "lookback_hours": _int_env("MONITOR_LOOKBACK_HOURS", 24),
        # 数据源：填了凭证/地址即启用；全部按书写顺序故障切换
        "sources": {
            "twitterapi_io": {
                "enabled": bool(_env("TWITTERAPI_IO_KEY")),
                "api_key": _env("TWITTERAPI_IO_KEY"),
            },
            "rsshub": {
                "enabled": bool(_env("RSSHUB_BASE_URL")),
                "base_url": _env("RSSHUB_BASE_URL"),
                "route": _env("RSSHUB_ROUTE", "twitter/user"),
                # RSSHub 实例设置了 ACCESS_KEY 鉴权时，携带同值访问
                "access_key": _env("RSSHUB_ACCESS_KEY"),
            },
        },
        # 通知渠道：填了 webhook/token 即启用，命中时全渠道并发推送
        "notifiers": {
            "feishu": {"enabled": bool(_env("FEISHU_WEBHOOK")), "webhook": _env("FEISHU_WEBHOOK")},
            "dingtalk": {"enabled": bool(_env("DINGTALK_WEBHOOK")), "webhook": _env("DINGTALK_WEBHOOK")},
            "wecom": {"enabled": bool(_env("WECOM_WEBHOOK")), "webhook": _env("WECOM_WEBHOOK")},
            "bark": {"enabled": bool(_env("BARK_URL")), "server_url": _env("BARK_URL")},
            "telegram": {
                "enabled": bool(_env("TG_BOT_TOKEN")) and bool(_env("TG_CHAT_ID")),
                "bot_token": _env("TG_BOT_TOKEN"),
                "chat_id": _env("TG_CHAT_ID"),
            },
        },
        "matcher": {"rules": _rules()},
        "notify_lang": notify_lang,
        "demo": os.environ.get("DEMO", "").strip() == "1",
        # 调试能力跟随运行环境：debug 环境下面板才显示"发送测试通知"
        "debug": env_mode == "debug",
        "config_file": ".env" if (ROOT / ".env").exists() else "环境变量（未创建 .env）",
    }
