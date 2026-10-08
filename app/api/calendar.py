"""重置日历路由。"""

from datetime import datetime, timezone

from fastapi import APIRouter, Query

from app.schemas import CalendarOut, UnifiedResponse, ok
from app.services import calendar as calendar_service

router = APIRouter()


@router.get("/api/calendar", response_model=UnifiedResponse[CalendarOut])
async def api_calendar(
    year: int = Query(default=None, ge=2000, le=2100),
    month: int = Query(default=None, ge=1, le=12),
):
    """月历事件流：年份/月份缺省取当前 UTC 月，供面板月历视图展示。"""
    now = datetime.now(timezone.utc)
    return ok(await calendar_service.assemble_calendar(year or now.year, month or now.month))
