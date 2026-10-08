"""AI 大模型接入：DeepSeek / OpenAI / Anthropic / GLM 四家厂商，对话补全统一出口。

厂商注册表 PROTOCOLS 决定报文协议与官方默认地址/模型；绝大多数厂商（DeepSeek、GLM、
及各类聚合网关）兼容 OpenAI 的 /chat/completions 协议，Anthropic 用自家 Messages 协议。
全部走 httpx 直连 JSON 接口，不引入任何 SDK 依赖。

结果统一为纯文本返回；调用失败抛异常，由上层用例（services/ai）按「fail-open」降级，
绝不影响轮询主流程。
"""

import logging
from typing import Any, Optional

from app.core.config import AiConfig

from . import anthropic, openai_compat

log = logging.getLogger("ai")


class AiError(RuntimeError):
    """AI 调用失败（含未配置 / 未知厂商），上层据此降级。"""


# 厂商注册表：protocol 决定报文格式，base_url / model 为官方默认值（配置可覆盖）
PROTOCOLS: dict[str, dict[str, str]] = {
    "deepseek": {"protocol": "openai", "base_url": "https://api.deepseek.com", "model": "deepseek-chat"},
    "openai": {"protocol": "openai", "base_url": "https://api.openai.com/v1", "model": "gpt-4o-mini"},
    "anthropic": {"protocol": "anthropic", "base_url": "https://api.anthropic.com", "model": "claude-3-5-haiku-latest"},
    "glm": {"protocol": "openai", "base_url": "https://open.bigmodel.cn/api/paas/v4", "model": "glm-4-flash"},
}


def provider_defaults(provider: str) -> Optional[dict[str, str]]:
    """厂商默认配置（模型 / 官方地址），供状态展示；未知厂商返回 None。"""
    return PROTOCOLS.get((provider or "").strip().lower())


def default_model(ai: AiConfig) -> str:
    """实际生效的模型名：显式配置优先，否则用厂商默认。"""
    spec = PROTOCOLS.get(ai.provider)
    return (ai.model or "").strip() or (spec or {}).get("model", "")


async def chat(ai: AiConfig, client, system: str, user: str, max_tokens: int = 1000) -> str:
    """对话补全统一出口：按厂商协议分发。任何失败统一抛 AiError，调用方无需感知厂商差异。"""
    spec = PROTOCOLS.get(ai.provider)
    if spec is None:
        raise AiError(f"未知 AI provider: {ai.provider}")
    if not ai.enabled:
        raise AiError("AI 未配置 API Key")
    base_url = (ai.base_url or spec["base_url"]).rstrip("/")
    model = default_model(ai)
    kwargs: dict[str, Any] = {
        "base_url": base_url,
        "api_key": ai.api_key,
        "model": model,
        "system": system,
        "user": user,
        "timeout": ai.timeout,
        "max_tokens": max_tokens,
    }
    try:
        if spec["protocol"] == "anthropic":
            return await anthropic.chat(client, **kwargs)
        return await openai_compat.chat(client, **kwargs)
    except AiError:
        raise
    except Exception as e:
        raise AiError(f"{type(e).__name__}: {e}") from e
