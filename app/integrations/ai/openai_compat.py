"""OpenAI 兼容协议的对话补全：DeepSeek / GLM 官方接口及大多数聚合网关均直接兼容。"""

import logging

log = logging.getLogger("ai.openai_compat")


async def chat(
    client, base_url: str, api_key: str, model: str, system: str, user: str, timeout: int, max_tokens: int
) -> str:
    """调用 {base_url}/chat/completions，返回首条回复文本；非 200 或空回复抛异常由上层统一降级。"""
    resp = await client.post(
        f"{base_url}/chat/completions",
        headers={"Authorization": f"Bearer {api_key}"},
        json={
            "model": model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            # 复核/翻译都要求输出确定性强：低温 + 限量（两类任务的单次输出都很短）
            "temperature": 0.2,
            "max_tokens": max_tokens,
            "stream": False,
        },
        timeout=timeout,
    )
    if resp.status_code != 200:
        raise RuntimeError(f"HTTP {resp.status_code}: {resp.text[:200]}")
    data = resp.json()
    choices = data.get("choices") or []
    content = ((choices[0] or {}).get("message") or {}).get("content") if choices else None
    text = (content or "").strip()
    if not text:
        raise RuntimeError("empty completion")
    return text
