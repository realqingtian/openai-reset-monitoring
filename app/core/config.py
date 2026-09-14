"""配置模块：pydantic-settings 类型化配置。

来源优先级：OS 环境变量 > 项目根目录 .env 文件 > 内置默认值。
约定：
- 数据源与通知渠道"填了凭证即启用，留空即停用"（enabled 由凭证推导，见各配置模型）；
- 环境变量留空（空字符串）视为未设置，使用默认值，与旧版行为一致。
"""

import json
import logging
from functools import cached_property
from pathlib import Path
from typing import Optional

from pydantic import BaseModel, Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parent.parent.parent
log = logging.getLogger("config")

# 内置命中规则：依据 Tibo 的历史措辞设计（同一条规则内所有正则全部命中才触发）。
# 如需自定义，设置环境变量 MONITOR_RULES_JSON（结构与此处一致）覆盖。
DEFAULT_RULES: list[dict] = [
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
        # 宽松兜底：如 "I will reset usage limits this evening"（预告式，无受众词）；
        # 也覆盖只说 "a reset" 不提限额的公告式措辞（"a reset is also landing by midnight today"）。
        # \ba\s+reset 要求冠词紧贴，避免 "factory reset"/"via reset" 这类非公告用法误报。
        "name": "全球重置·英文·宽",
        "enabled": True,
        "all_patterns": [
            r"reset(?:ted|ting|s)?\b",
            r"(?:usage|rate)[ _-]?limits?|\ba\s+reset\b",
        ],
    },
    {
        # 订阅停售/暂停类公告：如 "we're pausing subscriptions to our $200 Pro plan"。
        # 动作词与对象词双条件，避免日常推文里单个词误报。
        "name": "订阅暂停·英文",
        "enabled": True,
        "all_patterns": [
            r"\b(?:paus\w+|suspend\w*|halt(?:ed|ing|s)?|stop(?:s|ped|ping)?|clos(?:e|es|ed|ing)|on\s+hold|no\s+longer)\b",
            r"\bsubscri\w*|\bsign[- ]?ups?\b|\bsign(?:ing)?\s+up\b",
        ],
    },
    {
        # 订阅恢复/重开类公告：如 "Pro subscriptions are back"。
        # 恢复时机比暂停更难等，动作词放宽（back/again）：误报代价只是一次推送，漏报代价是错过恢复。
        "name": "订阅恢复·英文",
        "enabled": True,
        "all_patterns": [
            r"re-?open\w*|resum\w*|unpaus\w*|\b(?:is|are|was|were)\s+back\b|[’\']s\s+back\b|bring\w*\s+back\b|\bnow\s+(?:live|available|open)\b|\bagain\b",
            r"\bsubscri\w*|\bsign[- ]?ups?\b|\bsign(?:ing)?\s+up\b|\bpro\b",
        ],
    },
]


class RuleConfig(BaseModel):
    """单条命中规则。"""

    name: Optional[str] = None
    enabled: bool = True
    all_patterns: list[str] = Field(default_factory=list)


class MatcherConfig(BaseModel):
    rules: list[RuleConfig] = Field(default_factory=lambda: [RuleConfig(**r) for r in DEFAULT_RULES])


class ServiceConfig(BaseModel):
    host: str = "127.0.0.1"
    port: int = 8730


class TwitterapiIoConfig(BaseModel):
    """twitterapi.io 数据源：填了 API Key 即启用。"""

    api_key: str = ""
    # 接口默认只返回主贴；公告偶尔也会以回复形式发出（如停售公告的后续补充），默认一并监控
    include_replies: bool = True

    @property
    def enabled(self) -> bool:
        return bool(self.api_key.strip())


class RsshubConfig(BaseModel):
    """RSSHub 数据源：填了实例地址即启用。"""

    base_url: str = ""
    route: str = "twitter/user"
    access_key: str = ""
    # twitter/user 路由默认排除回复，开启时在路由末段追加 includeReplies=true
    include_replies: bool = True

    @property
    def enabled(self) -> bool:
        return bool(self.base_url.strip())


class SourcesConfig(BaseModel):
    twitterapi_io: TwitterapiIoConfig = TwitterapiIoConfig()
    rsshub: RsshubConfig = RsshubConfig()


class WebhookNotifierConfig(BaseModel):
    """webhook 型通知渠道基类：填了 webhook 即启用。"""

    webhook: str = ""

    @property
    def enabled(self) -> bool:
        return bool(self.webhook.strip())


class FeishuConfig(WebhookNotifierConfig):
    pass


class DingtalkConfig(WebhookNotifierConfig):
    pass


class WecomConfig(WebhookNotifierConfig):
    pass


class BarkConfig(BaseModel):
    server_url: str = ""

    @property
    def enabled(self) -> bool:
        return bool(self.server_url.strip())


class TelegramConfig(BaseModel):
    bot_token: str = ""
    chat_id: str = ""

    @property
    def enabled(self) -> bool:
        return bool(self.bot_token.strip()) and bool(self.chat_id.strip())


class NotifiersConfig(BaseModel):
    feishu: FeishuConfig = FeishuConfig()
    dingtalk: DingtalkConfig = DingtalkConfig()
    wecom: WecomConfig = WecomConfig()
    bark: BarkConfig = BarkConfig()
    telegram: TelegramConfig = TelegramConfig()


class Settings(BaseSettings):
    """全量配置。字段名即环境变量名的小写形式，pydantic-settings 自动映射（大小写不敏感）。"""

    model_config = SettingsConfigDict(
        env_file=ROOT / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # -- 服务 --
    monitor_env: str = "production"
    monitor_site_name: str = "Codex Reset Monitor"
    monitor_host: str = "127.0.0.1"
    monitor_port: int = 8730
    monitor_accounts: str = "thsottiaux"
    monitor_include_replies: bool = True
    monitor_poll_interval: int = 5
    monitor_lookback_hours: int = 24
    monitor_notify_lang: str = "zh"
    monitor_rules_json: Optional[str] = None
    monitor_access_token: str = ""
    monitor_public_url: str = ""
    # 数据源自告警：连续 N 轮检查失败后经通知渠道告警（0=关闭）；告警未恢复时每隔多少分钟重发（0=不重发）
    monitor_source_alert_threshold: int = 3
    monitor_source_alert_repeat_minutes: int = 60
    # 推文保留：未命中随窗口滚动清理，命中延长保留供节奏统计采样（重置节奏卡需要更长的样本）
    monitor_tweet_retention_days: int = 30
    monitor_hit_retention_days: int = 180
    demo: bool = False

    # -- 数据源凭证（填了即启用） --
    twitterapi_io_key: str = ""
    rsshub_base_url: str = ""
    rsshub_route: str = "twitter/user"
    rsshub_access_key: str = ""

    # -- 通知渠道凭证（填了即启用） --
    feishu_webhook: str = ""
    dingtalk_webhook: str = ""
    wecom_webhook: str = ""
    bark_url: str = ""
    tg_bot_token: str = ""
    tg_chat_id: str = ""

    @model_validator(mode="before")
    @classmethod
    def _drop_empty_env(cls, values):
        """环境变量为空字符串视为未设置：沿用旧 _env 约定，避免 .env 里的 `VAR=` 覆盖默认值。"""
        if isinstance(values, dict):
            return {k: v for k, v in values.items() if not (isinstance(v, str) and not v.strip())}
        return values

    @field_validator("monitor_env", mode="after")
    @classmethod
    def _normalize_env(cls, v):
        v = (v or "").strip().lower()
        return "debug" if v in ("debug", "dev", "development") else "production"

    @field_validator("monitor_notify_lang", mode="after")
    @classmethod
    def _normalize_lang(cls, v):
        v = (v or "").strip().lower()
        return v if v in ("zh", "en") else "zh"

    @field_validator("monitor_port", "monitor_poll_interval", "monitor_lookback_hours", mode="after")
    @classmethod
    def _positive(cls, v):
        return max(1, int(v))

    @field_validator("monitor_source_alert_threshold", "monitor_source_alert_repeat_minutes", mode="after")
    @classmethod
    def _non_negative(cls, v):
        # 0 有语义（关闭告警 / 不重发），不能被 _positive 的下限 1 吞掉
        return max(0, int(v))

    @field_validator("monitor_tweet_retention_days", "monitor_hit_retention_days", mode="after")
    @classmethod
    def _retention_positive(cls, v):
        # 保留期没有"关闭"语义，0 会退化成"全删"，钳到至少 1 天
        return max(1, int(v))

    # ---- 派生视图：与旧版 load_config() 返回的 dict 键一一对应 ----

    @property
    def env_mode(self) -> str:
        return self.monitor_env

    @property
    def debug(self) -> bool:
        return self.env_mode == "debug"

    @property
    def access_protected(self) -> bool:
        return bool(self.monitor_access_token.strip())

    @property
    def docs_enabled(self) -> bool:
        return self.debug

    @property
    def site_name(self) -> str:
        return self.monitor_site_name

    @property
    def config_file(self) -> str:
        return ".env" if (ROOT / ".env").exists() else "环境变量（未创建 .env）"

    @property
    def accounts(self) -> list[str]:
        parsed = [a.strip().lstrip("@") for a in self.monitor_accounts.split(",") if a.strip()]
        return parsed or ["thsottiaux"]

    @property
    def poll_interval_minutes(self) -> int:
        return self.monitor_poll_interval

    @property
    def lookback_hours(self) -> int:
        return self.monitor_lookback_hours

    @property
    def source_alert_threshold(self) -> int:
        return self.monitor_source_alert_threshold

    @property
    def source_alert_repeat_minutes(self) -> int:
        return self.monitor_source_alert_repeat_minutes

    @property
    def tweet_retention_days(self) -> int:
        return self.monitor_tweet_retention_days

    @property
    def hit_retention_days(self) -> int:
        return self.monitor_hit_retention_days

    @property
    def notify_lang(self) -> str:
        return self.monitor_notify_lang

    @property
    def service(self) -> ServiceConfig:
        return ServiceConfig(host=self.monitor_host, port=self.monitor_port)

    @property
    def sources(self) -> SourcesConfig:
        return SourcesConfig(
            twitterapi_io=TwitterapiIoConfig(
                api_key=self.twitterapi_io_key, include_replies=self.monitor_include_replies
            ),
            rsshub=RsshubConfig(
                base_url=self.rsshub_base_url,
                route=self.rsshub_route,
                access_key=self.rsshub_access_key,
                include_replies=self.monitor_include_replies,
            ),
        )

    @property
    def notifiers(self) -> NotifiersConfig:
        return NotifiersConfig(
            feishu=FeishuConfig(webhook=self.feishu_webhook),
            dingtalk=DingtalkConfig(webhook=self.dingtalk_webhook),
            wecom=WecomConfig(webhook=self.wecom_webhook),
            bark=BarkConfig(server_url=self.bark_url),
            telegram=TelegramConfig(bot_token=self.tg_bot_token, chat_id=self.tg_chat_id),
        )

    @cached_property
    def matcher(self) -> MatcherConfig:
        """命中规则：含 JSON 解析与校验，结果按实例缓存（避免每请求重复解析）。"""
        raw = self.monitor_rules_json
        if not raw:
            return MatcherConfig()
        try:
            parsed = json.loads(raw)
            if not isinstance(parsed, list) or not parsed:
                raise ValueError("必须是非空数组")
            return MatcherConfig(rules=[RuleConfig(**r) for r in parsed])
        except (ValueError, TypeError) as e:
            log.warning("MONITOR_RULES_JSON 解析失败（%s），使用内置默认规则", e)
            return MatcherConfig()


def load_config() -> Settings:
    """加载配置：OS 环境变量 > .env（ROOT 下）> 内置默认值。"""
    return Settings()
