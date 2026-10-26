"""只读账本；读取不创建快照、不调用模型。"""

from fastapi import APIRouter, Query

from app.schemas.common import ok
from app.services import forecast_history

router = APIRouter()


@router.get("/api/forecast-history")
async def history(limit: int = Query(30, gt=0, le=100)):
    return ok(await forecast_history.history(limit))
