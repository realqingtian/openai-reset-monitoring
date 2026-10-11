"""重置节奏统计路由。"""

from fastapi import APIRouter, Request

from app.schemas import StatsOut, UnifiedResponse, ok
from app.services import stats as stats_service

router = APIRouter()


@router.get("/api/stats", response_model=UnifiedResponse[StatsOut])
async def api_stats(request: Request):
    return ok(await stats_service.assemble_stats(request.app.state.cfg))
