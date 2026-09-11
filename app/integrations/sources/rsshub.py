"""数据源：RSSHub（免费兜底；Twitter 路由需要自建 RSSHub 并配置 X 登录态 Cookie）。"""

import hashlib
import html as htmllib
import re
import xml.etree.ElementTree as ET

from app.core.config import RsshubConfig
from app.core.timeutil import parse_dt

STATUS_RE = re.compile(r"/status/(\d+)")
TAG_RE = re.compile(r"<[^>]+>")
MAX_FEED_BYTES = 2 * 1024 * 1024
# 标准库 ElementTree 不防护实体扩展（billion laughs），含 DTD 声明的响应直接拒绝解析
DTD_MARKERS = (b"<!doctype", b"<!entity", b"<!element", b"<!attlist", b"<!notation")


def is_configured(scfg: RsshubConfig) -> bool:
    return bool(scfg.base_url.strip())


def _strip_html(s):
    s = re.sub(r"<br\s*/?>", "\n", s or "")
    s = TAG_RE.sub("", s)
    return htmllib.unescape(s).strip()


def _safe_parse(content):
    if len(content) > MAX_FEED_BYTES:
        raise RuntimeError("RSS 响应超过 2MB，已拒绝解析")
    lowered = content.lower()
    if any(marker in lowered for marker in DTD_MARKERS):
        raise RuntimeError("RSS 内容包含 DTD 声明，已拒绝解析（防 XML 实体扩展）")
    return ET.fromstring(content)


async def fetch(client, scfg: RsshubConfig, account, backfill=False, **_):
    base = (scfg.base_url or "").rstrip("/")
    route = (scfg.route or "twitter/user").strip("/")
    # 实例启用了 ACCESS_KEY 鉴权时自动附带 key 参数
    params = {"key": scfg.access_key} if scfg.access_key else None
    resp = await client.get(
        f"{base}/{route}/{account}",
        params=params,
        timeout=30,
        headers={"User-Agent": "Mozilla/5.0 (compatible; reset-monitor/1.0)"},
    )
    resp.raise_for_status()
    root = _safe_parse(resp.content)
    out = []
    for item in root.iter("item"):
        title = item.findtext("title") or ""
        desc = item.findtext("description") or ""
        link = item.findtext("link") or item.findtext("guid") or ""
        pub = item.findtext("pubDate") or ""
        m = STATUS_RE.search(link or "")
        # 无 status id 时用链接的稳定哈希兜底：内建 hash() 带进程随机化，重启会变
        tid = m.group(1) if m else "rss-" + hashlib.sha256((link or title).encode("utf-8")).hexdigest()[:16]
        text = _strip_html(desc) or _strip_html(title)
        if not text:
            continue
        out.append(
            {
                "id": tid,
                "account": account,
                "text": text,
                "url": f"https://x.com/{account}/status/{tid}",
                "created_at": parse_dt(pub),
                "source": "rsshub",
            }
        )
    return out
