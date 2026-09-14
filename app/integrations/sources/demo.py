"""DEMO=1 时的模拟数据源：生成含一条命中公告的样例推文，用于无凭证演示与自检。"""

from typing import Optional

from app.core.config import RsshubConfig
from app.core.timeutil import hours_ago_iso

_cache = None


def is_configured(scfg: Optional[RsshubConfig]) -> bool:
    return True


def _sample_tweets(account="thsottiaux"):
    def at(hours_ago):
        return hours_ago_iso(hours_ago)

    return [
        {
            "id": "demo-1001",
            "account": account,
            "source": "demo",
            "text": "Usage limits have been reset for all paid ChatGPT Work and Codex users. "
            "Happy Monday you all. Hope it is a fantastic week.",
            "url": f"https://x.com/{account}/status/2086972933566857393",
            "created_at": at(6),
            "is_reply": 0,
        },
        {
            "id": "demo-1002",
            "account": account,
            "source": "demo",
            "text": "Shipping some improvements to codex CLI review mode tonight. "
            "Also exploring better context compression for long running tasks.",
            "url": f"https://x.com/{account}/status/2086000000000000001",
            "created_at": at(2),
            "is_reply": 1,
        },
        {
            "id": "demo-1003",
            "account": account,
            "source": "demo",
            "text": "We are investigating reports of slow responses in codex. "
            "Root cause looks like an upstream provider issue. Will share updates here.",
            "url": f"https://x.com/{account}/status/2086000000000000002",
            "created_at": at(11),
            "is_reply": 0,
        },
        {
            "id": "demo-1004",
            "account": account,
            "source": "demo",
            "text": "Great energy at the hackathon yesterday. Thanks to everyone who came out "
            "and built with us all weekend.",
            "url": f"https://x.com/{account}/status/2086000000000000003",
            "created_at": at(20),
            "is_reply": 0,
        },
        {
            "id": "demo-1005",
            "account": account,
            "source": "demo",
            "text": "As we are still investigating, I have reset everyone's Codex usage limits. "
            "This is a hard reset given some users had stacked up to three weeks of usage.",
            "url": f"https://x.com/{account}/status/2071381664853319742",
            "created_at": at(30),
            "is_reply": 0,
        },  # 超出 24 小时窗口，用于验证窗口过滤
        {
            "id": "demo-1006",
            "account": account,
            "source": "demo",
            "text": "Weekly maintenance is done and usage limits have been reset for all Codex users. "
            "Back to full quotas everywhere.",
            "url": f"https://x.com/{account}/status/2069000000000000001",
            "created_at": at(54),
            "is_reply": 0,
        },
        {
            "id": "demo-1007",
            "account": account,
            "source": "demo",
            "text": "Long week of incident work, so I have reset the Codex usage limits once more. "
            "Everyone should see fresh quotas now.",
            "url": f"https://x.com/{account}/status/2066000000000000001",
            "created_at": at(78),
            "is_reply": 0,
        },
        {
            "id": "demo-1008",
            "account": account,
            "source": "demo",
            "text": "Reading through your codex CLI feedback threads this weekend. "
            "Lots of good suggestions about context management.",
            "url": f"https://x.com/{account}/status/2063000000000000001",
            "created_at": at(96),
            "is_reply": 0,
        },
    ]


async def fetch(client, scfg: Optional[RsshubConfig], account, backfill=False, **_):
    global _cache
    if _cache is None:
        _cache = _sample_tweets(account)
    return list(_cache)
