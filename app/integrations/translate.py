"""帖子按需翻译：Chrome 内置翻译接口（Google 后端）为主，MyMemory 匿名接口兜底。

两个接口都免 key：
- clients5.google.com/translate_a/t?client=dict-chrome-ex：Chrome 浏览器内置翻译通道，
  译文质量好，但在大陆网络需要代理在线；sl=auto 时返回 [[译文, 检测到的源语言]]。
- api.mymemory.translated.net/get：大陆可直连，匿名配额 5000 字符/天、单次约 500 字符，
  译文质量一般，仅作兜底；语言对固定 en|目标（监控账号为英文发帖）。

结果统一返回 dict：{ok, same, text, source, provider, error}。
"""
import logging

log = logging.getLogger("translate")

# 超长截断：推文本体很短，这里只为防异常数据把 GET 的 URL 撑爆
MAX_LEN = 1200
# MyMemory 单次查询上限（匿名档），超过则不做兜底
MYMEMORY_MAX = 450

_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
}


def _chrome_extract(data):
    """解析 dict-chrome-ex 的返回：固定源语言时是 ["译文"]，sl=auto 时是 [["译文","en"]]。"""
    if not isinstance(data, list) or not data:
        return None
    first = data[0]
    if isinstance(first, str):
        return first, None
    if isinstance(first, list):
        # 少数情况下长文本会按句分段：[[t1,lang],[t2,lang]...]
        if first and isinstance(first[0], list):
            parts, src = [], None
            for seg in first:
                if isinstance(seg, list) and seg and isinstance(seg[0], str):
                    parts.append(seg[0])
                    if src is None and len(seg) > 1 and isinstance(seg[1], str):
                        src = seg[1]
            if parts:
                return "".join(parts), src
        elif first and isinstance(first[0], str):
            src = first[1] if len(first) > 1 and isinstance(first[1], str) else None
            return first[0], src
    return None


async def _via_google(client, text, target):
    r = await client.get(
        "https://clients5.google.com/translate_a/t",
        params={"client": "dict-chrome-ex", "sl": "auto", "tl": target, "q": text},
        headers=_HEADERS, timeout=10,
    )
    if r.status_code != 200:
        raise RuntimeError(f"HTTP {r.status_code}")
    got = _chrome_extract(r.json())
    if not got:
        raise RuntimeError("unexpected response shape")
    return got  # (译文, 源语言)


async def _via_mymemory(client, text, target):
    r = await client.get(
        "https://api.mymemory.translated.net/get",
        params={"q": text, "langpair": f"en|{target}"},
        headers=_HEADERS, timeout=15,
    )
    if r.status_code != 200:
        raise RuntimeError(f"HTTP {r.status_code}")
    d = r.json()
    if d.get("responseStatus") != 200:
        raise RuntimeError(str(d.get("responseDetails") or "quota/limit"))
    translated = (d.get("responseData") or {}).get("translatedText") or ""
    if not translated.strip():
        raise RuntimeError("empty translation")
    return translated, "en"


async def translate_text(client, text, target="zh-CN"):
    """翻译一段文本。same=True 表示原文已是目标语言，无需展示译文。"""
    text = (text or "").strip()
    if not text:
        return {"ok": False, "error": "empty"}
    truncated = len(text) > MAX_LEN
    if truncated:
        text = text[:MAX_LEN]

    try:
        translated, source = await _via_google(client, text, target)
        if source and source.split("-")[0] == target.split("-")[0]:
            return {"ok": True, "same": True, "source": source, "provider": "google"}
        return {"ok": True, "same": False, "text": translated, "source": source,
                "provider": "google", "truncated": truncated}
    except Exception as e:
        log.warning("Google 翻译通道失败，尝试 MyMemory 兜底：%s", e)

    if len(text) <= MYMEMORY_MAX:
        try:
            translated, source = await _via_mymemory(client, text, target)
            return {"ok": True, "same": False, "text": translated, "source": source,
                    "provider": "mymemory", "truncated": truncated}
        except Exception as e:
            log.warning("MyMemory 兜底也失败：%s", e)

    return {"ok": False, "error": "translate_failed"}
