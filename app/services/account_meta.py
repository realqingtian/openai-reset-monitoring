"""账号元数据（X 昵称/头像）缓存：轮询时从数据源响应提取，按账号存 app_state，供推文卡片展示。

放 app_state 键值表而不是 tweets 行：头像/昵称是账号级常量，旧推文不用回填即全部生效，
也免去 tweets 表迁移。键 account_meta:{handle}，值 JSON {"name": ..., "avatar": ...}。
"""

import json
import logging

from app.repositories import app_state as state_repo
from app.schemas import TweetOut

log = logging.getLogger("account_meta")

_PREFIX = "account_meta:"


def _key(account: str) -> str:
    return _PREFIX + account


async def upsert_from_source(account: str, meta: dict) -> None:
    """把数据源提取到的昵称/头像合并进缓存；两者皆空时不写（保留旧值，前端字母头像兜底）。"""
    name = str((meta or {}).get("name") or "").strip()
    avatar = str((meta or {}).get("avatar") or "").strip()
    if not name and not avatar:
        return
    # 字段级合并：某次响应缺头像/昵称时不冲掉已知的另一半
    current = await all_meta()
    old = current.get(account) or {}
    payload = {"name": name or old.get("name") or "", "avatar": avatar or old.get("avatar") or ""}
    await state_repo.set_many({_key(account): json.dumps(payload, ensure_ascii=False)})


async def all_meta() -> dict[str, dict]:
    """全部账号元数据 {handle: {"name", "avatar"}}；坏值跳过不抛（缓存损坏不该影响出参）。"""
    metas: dict[str, dict] = {}
    for key, raw in (await state_repo.get_all()).items():
        if not key.startswith(_PREFIX):
            continue
        try:
            data = json.loads(raw)
        except ValueError:
            log.warning("账号元数据 %s 不是合法 JSON，已忽略", key)
            continue
        if isinstance(data, dict):
            metas[key[len(_PREFIX) :]] = data
    return metas


async def enrich_tweets(dtos: list[TweetOut]) -> None:
    """就地补全推文 DTO 的 author_name / author_avatar（按账号查缓存，未命中留空走前端降级）。"""
    if not dtos:
        return
    metas = await all_meta()
    for d in dtos:
        m = metas.get(d.account) or {}
        d.author_name = (m.get("name") or "").strip() or None
        d.author_avatar = (m.get("avatar") or "").strip() or None
