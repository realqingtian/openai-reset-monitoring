"""面板状态聚合：数据与字段与旧版 /api/status 完全一致。"""

from app.core.config import RuleConfig
from app.core.timeutil import hours_ago_iso
from app.integrations.notifiers import notifier_states
from app.integrations.sources import source_states
from app.repositories import healths as health_repo
from app.repositories import polls as poll_repo
from app.repositories import tweets as tweet_repo
from app.schemas import NotifierState, RuleInfo, SourceState, StatusOut, TweetOut


async def assemble_status(cfg, rules: list[RuleConfig]) -> StatusOut:
    """rules 为启用的原始规则配置（cfg.matcher.rules），仅用于展示字段。"""
    since = hours_ago_iso(cfg.lookback_hours)
    recent = await tweet_repo.tweets_since(since)
    hits = [t for t in recent if t["matched"]]
    last_polls = await poll_repo.recent_polls(1)
    healths = await health_repo.get_healths()
    return StatusOut(
        demo=cfg.demo,
        debug=cfg.debug,
        env_mode=cfg.env_mode,
        site_name=cfg.site_name,
        config_file=cfg.config_file,
        accounts=cfg.accounts,
        poll_interval_minutes=cfg.poll_interval_minutes,
        lookback_hours=cfg.lookback_hours,
        last_poll_at=last_polls[0]["ts"] if last_polls else None,
        tweets_24h=len(recent),
        hit_count_24h=len(hits),
        latest_hit=TweetOut.model_validate(hits[0]) if hits else None,
        hits=[TweetOut.model_validate(t) for t in hits],
        sources=[SourceState.model_validate(s) for s in source_states(cfg, healths)],
        notifiers=[NotifierState.model_validate(n) for n in notifier_states(cfg)],
        rules=[RuleInfo(name=r.name, patterns=r.all_patterns or []) for r in rules or [] if r.enabled],
    )
