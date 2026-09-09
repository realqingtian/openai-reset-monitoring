"""数据源管理：按配置顺序尝试，失败自动切换下一个（故障切换）。"""
import time

from app import db
from app import demo as demo_mod
from app.sources import rsshub, twitterapi_io

CHAIN = {"twitterapi_io": twitterapi_io, "rsshub": rsshub}


def source_states(cfg, healths):
    """供面板展示的各数据源状态。"""
    states = []
    for name, scfg in (cfg.get("sources") or {}).items():
        mod = CHAIN.get(name)
        h = healths.get(name) or {}
        states.append({
            "name": name,
            "enabled": bool(scfg.get("enabled")),
            "configured": bool(mod and mod.is_configured(scfg)),
            "known": name in healths,
            "healthy": bool(h.get("healthy")),
            "failures": h.get("failures", 0),
            "last_ok": h.get("last_ok"),
            "last_error": h.get("last_error"),
        })
    return states


def _chain(cfg):
    """返回 (名称, 模块, 源配置) 列表；DEMO 模式只使用内置演示源。"""
    if cfg.get("demo"):
        return [("demo", demo_mod, {"enabled": True})]
    sources = cfg.get("sources") or {}
    return [(name, mod, sources.get(name) or {}) for name, mod in CHAIN.items() if name in sources]


async def fetch_with_failover(state, account, backfill=False):
    """依次尝试数据源，返回 (tweets, 使用的源名, 尝试记录列表)。"""
    cfg = state.cfg
    attempts = []
    for name, mod, scfg in _chain(cfg):
        if not scfg.get("enabled"):
            continue
        if not mod.is_configured(scfg):
            continue
        t0 = time.monotonic()
        try:
            tweets = await mod.fetch(state.client, scfg, account, backfill=backfill)
            latency = int((time.monotonic() - t0) * 1000)
            attempts.append({"source": name, "state": "ok", "error": None,
                             "latency_ms": latency, "count": len(tweets)})
            db.set_health(name, True)
            return tweets, name, attempts
        except Exception as e:  # noqa: BLE001 — 任何抓取失败都降级到下一个源
            latency = int((time.monotonic() - t0) * 1000)
            err = f"{type(e).__name__}: {e}"[:300]
            attempts.append({"source": name, "state": "error", "error": err,
                             "latency_ms": latency, "count": 0})
            db.set_health(name, False, err)
    return [], None, attempts
