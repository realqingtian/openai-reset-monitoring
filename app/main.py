"""FastAPI 入口：面板页面 + JSON API + 后台轮询任务。"""
import asyncio
import json
import logging
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
import uvicorn
from fastapi import FastAPI, Query
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from app import config as config_mod
from app import db, matcher, notifiers, poller
from app.sources import source_states
from app.util import hours_ago_iso

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
ROOT = Path(__file__).resolve().parent.parent
INDEX_PATH = ROOT / "app" / "web" / "index.html"


@asynccontextmanager
async def lifespan(application: FastAPI):
    cfg = config_mod.load_config()
    db.init_db()
    application.state.cfg = cfg
    application.state.rules = matcher.compile_rules((cfg.get("matcher") or {}).get("rules"))
    application.state.client = httpx.AsyncClient(follow_redirects=True)
    application.state.poll_lock = asyncio.Lock()
    task = asyncio.create_task(poller.poll_loop(application))
    yield
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass
    await application.state.client.aclose()


app = FastAPI(title="OpenAI Reset Monitoring", lifespan=lifespan)
app.mount("/static", StaticFiles(directory=ROOT / "app" / "web" / "static"), name="static")


def _tweet_dto(row):
    try:
        terms = json.loads(row.get("matched_terms") or "[]")
    except (TypeError, ValueError):
        terms = []
    return {
        "id": row["id"], "account": row["account"], "text": row["text"],
        "url": row["url"], "created_at": row["created_at"], "source": row["source"],
        "matched": bool(row.get("matched")), "rule_name": row.get("rule_name"),
        "matched_terms": terms, "notified": bool(row.get("notified")),
    }


@app.get("/", response_class=HTMLResponse)
async def index():
    # no-cache：页面更新后浏览器刷新即可拿到最新版，避免旧缓存误导
    return HTMLResponse(INDEX_PATH.read_text(encoding="utf-8"), headers={"Cache-Control": "no-cache"})


@app.get("/api/status")
async def api_status():
    cfg = app.state.cfg
    since = hours_ago_iso(cfg["lookback_hours"])
    recent = db.tweets_since(since)
    hits = [t for t in recent if t["matched"]]
    last_polls = db.recent_polls(1)
    return {
        "demo": cfg.get("demo", False),
        "debug": cfg.get("debug", False),
        "env_mode": cfg.get("env_mode", "production"),
        "site_name": cfg.get("site_name"),
        "config_file": cfg.get("config_file"),
        "accounts": cfg["accounts"],
        "poll_interval_minutes": cfg["poll_interval_minutes"],
        "lookback_hours": cfg["lookback_hours"],
        "last_poll_at": last_polls[0]["ts"] if last_polls else None,
        "tweets_24h": len(recent),
        "hit_count_24h": len(hits),
        "latest_hit": _tweet_dto(hits[0]) if hits else None,
        "hits": [_tweet_dto(t) for t in hits],
        "sources": source_states(cfg, db.get_healths()),
        "notifiers": notifiers.notifier_states(cfg),
        "rules": [{"name": r.get("name"), "patterns": r.get("all_patterns") or []}
                  for r in (cfg.get("matcher") or {}).get("rules", []) if r.get("enabled", True)],
    }


@app.get("/api/tweets")
async def api_tweets(hours: float = Query(default=None, gt=0, le=720)):
    cfg = app.state.cfg
    since = hours_ago_iso(hours if hours is not None else cfg["lookback_hours"])
    return [_tweet_dto(t) for t in db.tweets_since(since)]


@app.get("/api/hits")
async def api_hits(limit: int = Query(default=100, gt=0, le=500)):
    return [_tweet_dto(t) for t in db.matched_tweets(limit)]


@app.get("/api/polls")
async def api_polls(limit: int = Query(default=30, gt=0, le=200)):
    return db.recent_polls(limit)


@app.post("/api/poll-now")
async def api_poll_now():
    await poller.run_poll(app)
    return {"ok": True}


@app.post("/api/test-notify")
async def api_test_notify():
    # 测试通知仅调试环境（MONITOR_ENV=debug）可用，生产环境直接拒绝
    if not app.state.cfg.get("debug"):
        return JSONResponse({"ok": False, "error": "测试通知仅在 MONITOR_ENV=debug 调试环境下可用"}, status_code=403)
    return await notifiers.send_test(app.state.cfg)


@app.get("/healthz")
async def healthz():
    return JSONResponse({"ok": True})


if __name__ == "__main__":
    _cfg = config_mod.load_config()
    uvicorn.run("app.main:app", host=_cfg["service"]["host"], port=int(_cfg["service"]["port"]), log_level="info")
