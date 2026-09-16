"""数据源：RSSHub（免费兜底；Twitter 路由需要自建 RSSHub 并配置 X 登录态 Cookie）。"""

import hashlib
import html as htmllib
import re
import xml.etree.ElementTree as ET

from app.core.config import RsshubConfig
from app.core.timeutil import parse_dt

STATUS_RE = re.compile(r"/status/(\d+)")
TAG_RE = re.compile(r"<[^>]+>")
# RSSHub twitter 路由的 feed 标题形态不一：实测自建实例为「Twitter @Tibo」，社区版常见「Tibo's Twitter / - X / on X」
FEED_TITLE_PREFIX_RE = re.compile(r"^twitter\s+@?", re.IGNORECASE)
FEED_TITLE_TAIL_RE = re.compile(r"(?:\s*['’]s|\s+[-–/]\s*|\s+on\s+)(?:twitter|x)\s*$", re.IGNORECASE)
MAX_FEED_BYTES = 2 * 1024 * 1024
# 标准库 ElementTree 不防护实体扩展（billion laughs），含 DTD 声明的响应直接拒绝解析
DTD_MARKERS = (b"<!doctype", b"<!entity", b"<!element", b"<!attlist", b"<!notation")


def is_configured(scfg: RsshubConfig) -> bool:
    return bool(scfg.base_url.strip())


def _strip_html(s):
    s = re.sub(r"<br\s*/?>", "\n", s or "")
    s = TAG_RE.sub("", s)
    return htmllib.unescape(s).strip()


def _author_meta(root, account):
    """从 feed 频道信息提取作者昵称与头像；频道是账号级信息，取不到就不写缓存（前端字母头像兜底）。"""
    ch = root.find("channel")
    if ch is None:
        return {}
    name = (ch.findtext("title") or "").strip()
    # 「Twitter @Tibo」→「Tibo」；「Tibo's Twitter」等后缀形态 →「Tibo」
    m = FEED_TITLE_PREFIX_RE.match(name)
    name = name[m.end() :].strip() if m else FEED_TITLE_TAIL_RE.sub("", name).strip()
    avatar = (ch.findtext("image/url") or "").strip()
    meta: dict[str, str] = {}
    # 剩下的就是 handle 本身（如「@thsottiaux - Twitter」清完只剩 handle）时没有昵称价值
    if name and name.lstrip("@").lower() != account.lower():
        meta["name"] = name
    if avatar:
        meta["avatar"] = avatar
    return meta


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
    url = f"{base}/{route}/{account}"
    # twitter/user 路由默认排除回复；开启回复监控时按 routeParams 约定追加（URLSearchParams 语法）
    if scfg.include_replies:
        url += "/includeReplies=true"
    # 实例启用了 ACCESS_KEY 鉴权时自动附带 key 参数
    params = {"key": scfg.access_key} if scfg.access_key else None
    resp = await client.get(
        url,
        params=params,
        timeout=30,
        headers={"User-Agent": "Mozilla/5.0 (compatible; reset-monitor/1.0)"},
    )
    resp.raise_for_status()
    root = _safe_parse(resp.content)
    meta = _author_meta(root, account)
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
                # RSS 条目无法判定是否回复，存 NULL，面板不显示回复徽章
                "is_reply": None,
            }
        )
    return out, meta
