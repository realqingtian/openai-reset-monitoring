"""时间解析与 UTC ISO 格式化（固定宽度，可直接字符串比较）。"""

import re
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime

_ISO_FMT = "%Y-%m-%dT%H:%M:%S"


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
