"""系统路由：健康检查与测试通知。"""

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app.schemas import TestNotifyResult, UnifiedResponse, ok
from app.services import notify as notify_service

router = APIRouter()


@router.get("/healthz")
async def healthz():
    # docker healthcheck 依赖该路径返回原样 {"ok": true}，不参与统一响应包裹
    return JSONResponse({"ok": True})


@router.post("/api/test-notify", response_model=UnifiedResponse[list[TestNotifyResult]])
async def api_test_notify(request: Request):
    return ok(await notify_service.test_notify(request.app.state.cfg))
