"""FastAPI 入口：应用装配 + 面板页面。所有 /api/* 路由在 app/api/ 按域拆分。

响应包体与异常处理约定不变：/api/* 统一 {code, data, message} 包体，
异常经 errors.register_exception_handlers 统一转换；/healthz 例外，
docker healthcheck 依赖原样 {"ok": true}。
"""

import asyncio
import logging
from contextlib import asynccontextmanager, suppress
from pathlib import Path
from typing import Optional

import httpx
import uvicorn
from fastapi import FastAPI
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles

from app.api import api_router
from app.core import config as config_mod
from app.core import errors as errors_mod
from app.db import database
from app.services import matcher, poller

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
ROOT = Path(__file__).resolve().parent.parent
INDEX_PATH = ROOT / "app" / "web" / "index.html"

# 配置在导入期加载一次：docs 开关要赶在 FastAPI 实例化前生效，lifespan 复用同一份
CFG = config_mod.load_config()


@asynccontextmanager
async def lifespan(application: FastAPI):
    await database.init_db()
    application.state.cfg = CFG
    application.state.rules = matcher.compile_rules(CFG.matcher.rules)
    application.state.client = httpx.AsyncClient(follow_redirects=True)
    application.state.poll_lock = asyncio.Lock()
    task = asyncio.create_task(poller.poll_loop(application))
    yield
    task.cancel()
    with suppress(asyncio.CancelledError):
        await task
    await application.state.client.aclose()


# API 自动文档仅在开发/调试环境（MONITOR_ENV=debug）开放；生产环境不注册这些路由
_DOCS_URL: Optional[str] = "/docs" if CFG.docs_enabled else None
_REDOC_URL: Optional[str] = "/redoc" if CFG.docs_enabled else None
_OPENAPI_URL: Optional[str] = "/openapi.json" if CFG.docs_enabled else None

app = FastAPI(
    title="OpenAI Reset Monitoring",
    lifespan=lifespan,
    docs_url=_DOCS_URL,
    redoc_url=_REDOC_URL,
    openapi_url=_OPENAPI_URL,
)
app.mount("/static", StaticFiles(directory=ROOT / "app" / "web" / "static"), name="static")
errors_mod.register_exception_handlers(app)
app.include_router(api_router)


@app.get("/", response_class=HTMLResponse)
async def index():
    # no-cache：页面更新后浏览器刷新即可拿到最新版，避免旧缓存误导
    return HTMLResponse(INDEX_PATH.read_text(encoding="utf-8"), headers={"Cache-Control": "no-cache"})


if __name__ == "__main__":
    uvicorn.run("app.main:app", host=CFG.service.host, port=int(CFG.service.port), log_level="info")
