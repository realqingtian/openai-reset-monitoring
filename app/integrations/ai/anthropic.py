"""Anthropic（Claude）Messages 协议：与 OpenAI 兼容协议的差异只在报文与响应形状。"""

import logging

log = logging.getLogger("ai.anthropic")

# 官方要求的协议版本头（更新缓慢，写死即可）
_VERSION = "2023-06-01"


async def chat(
    client, base_url: str, api_key: str, model: str, system: str, user: str, timeout: int, max_tokens: int
) -> str:
    """调用 {base_url}/v1/messages，返回 text 块拼接；非 200 或空回复抛异常由上层统一降级。"""
    resp = await client.post(
        f"{base_url}/v1/messages",
        headers={"x-api-key": api_key, "anthropic-version": _VERSION},
        json={
            "model": model,
            "max_tokens": max_tokens,
            "system": system,
            "messages": [{"role": "user", "content": user}],
            "temperature": 0.2,
        },
        timeout=timeout,
    )
    if resp.status_code != 200:
        raise RuntimeError(f"HTTP {resp.status_code}: {resp.text[:200]}")
    data = resp.json()
    parts = [b.get("text", "") for b in data.get("content") or [] if isinstance(b, dict) and b.get("type") == "text"]
    text = "".join(parts).strip()
    if not text:
        raise RuntimeError("empty completion")
    return text
