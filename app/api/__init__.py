"""API 路由层：按域拆分的 router，由 main.py 一次 include。"""

from fastapi import APIRouter

from app.api import (
    auth,
    calendar,
    event_reviews,
    events,
    exports,
    forecast_history,
    mcp,
    monitor,
    polls,
    stats,
    status,
    subscriptions,
    system,
    translate,
    tweets,
)

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(status.router)
api_router.include_router(tweets.router)
api_router.include_router(polls.router)
api_router.include_router(stats.router)
api_router.include_router(calendar.router)
api_router.include_router(translate.router)
api_router.include_router(system.router)
api_router.include_router(monitor.router)
api_router.include_router(events.router)

api_router.include_router(exports.router)

api_router.include_router(forecast_history.router)

api_router.include_router(event_reviews.router)

api_router.include_router(mcp.router)

api_router.include_router(subscriptions.router)
