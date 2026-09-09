"""通用工具：时间解析与 UTC ISO 格式化（固定宽度，可直接字符串比较）。"""
import hashlib
import re
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime

_ISO_FMT = "%Y-%m-%dT%H:%M:%S"


def content_hash(text):
    """推文内容指纹：归一化空白与大小写后取哈希，用于"同内容不同推文"的去重。"""
    return hashlib.sha256(normalize_text(text).encode("utf-8")).hexdigest()


def normalize_text(text):
    return re.sub(r"\s+", " ", (text or "")).strip().lower()


def texts_similar(a, b, threshold=0.8):
    """判断两段归一化文本是否高度相似（同一公告被发布/转发多条的场景）。

    用重叠系数 M/min(len_a, len_b)：对"一条是另一条的子集/转发修正版"更稳健。
    autojunk 必须关闭，否则长文本里的高频字符会被当作垃圾导致相似度失真。
    """
    from difflib import SequenceMatcher
    if not a or not b:
        return False
    sm = SequenceMatcher(None, a, b, autojunk=False)
    matched = sum(block.size for block in sm.get_matching_blocks())
    overlap = matched / min(len(a), len(b))
    return overlap >= threshold


def iso_utc(dt=None):
    dt = dt or datetime.now(timezone.utc)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).strftime(_ISO_FMT) + f".{dt.microsecond // 1000:03d}Z"


def hours_ago_iso(hours):
    return iso_utc(datetime.now(timezone.utc) - timedelta(hours=hours))


def parse_dt(value):
    """尽力解析第三方源返回的各种时间格式，失败时退回当前时间。统一输出 UTC 存储。"""
    s = (str(value) if value is not None else "").strip()
    if not s:
        return iso_utc()
    if re.fullmatch(r"\d{13}", s):
        return iso_utc(datetime.fromtimestamp(int(s) / 1000, tz=timezone.utc))
    if re.fullmatch(r"\d{10}", s):
        return iso_utc(datetime.fromtimestamp(int(s), tz=timezone.utc))
    try:
        return iso_utc(datetime.fromisoformat(s.replace("Z", "+00:00")))
    except ValueError:
        pass
    try:
        return iso_utc(parsedate_to_datetime(s))
    except (TypeError, ValueError):
        pass
    try:
        return iso_utc(datetime.strptime(s, "%a %b %d %H:%M:%S %z %Y"))
    except ValueError:
        pass
    return iso_utc()
