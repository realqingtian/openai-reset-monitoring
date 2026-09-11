"""状态查询路由。"""

from fastapi import APIRouter, Request

from app.schemas import StatusOut, UnifiedResponse, ok
from app.services import status as status_service

router = APIRouter()


@router.get("/api/status", response_model=UnifiedResponse[StatusOut])
async def api_status(request: Request):
    cfg = request.app.state.cfg
    rules = cfg.matcher.rules
    return ok(await status_service.assemble_status(cfg, rules))
