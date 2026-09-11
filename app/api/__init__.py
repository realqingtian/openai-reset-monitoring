"""API 路由层：按域拆分的 router，由 main.py 一次 include。"""

from fastapi import APIRouter

from app.api import polls, status, system, translate, tweets

api_router = APIRouter()
api_router.include_router(status.router)
api_router.include_router(tweets.router)
api_router.include_router(polls.router)
api_router.include_router(translate.router)
api_router.include_router(system.router)
