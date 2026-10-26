"""公开新鲜度只给摘要，错误详情与投递记录使用管理员操作鉴权。"""

from fastapi import APIRouter, Depends, Query, Request

from app.core.security import require_login
from app.schemas.common import UnifiedResponse, ok
from app.schemas.monitor import MonitorAdminOut, MonitorHealthOut
from app.services import monitor

router = APIRouter()


@router.get("/api/monitor", response_model=UnifiedResponse[MonitorHealthOut])
async def public_monitor(request: Request):
    return ok(await monitor.summary(request.app.state.cfg))


@router.get(
    "/api/admin/monitor", response_model=UnifiedResponse[MonitorAdminOut], dependencies=[Depends(require_login)]
)
async def admin_monitor(request: Request, limit: int = Query(default=200, gt=0, le=200)):
    return ok(await monitor.admin_details(request.app.state.cfg, limit))
