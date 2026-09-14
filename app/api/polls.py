"""轮询日志查询与手动触发路由。"""

from fastapi import APIRouter, Depends, Query, Request

from app.core.security import require_access_token
from app.schemas import PollOut, UnifiedResponse, ok
from app.services import poller
from app.services import polls as polls_service

router = APIRouter()


@router.get("/api/polls", response_model=UnifiedResponse[list[PollOut]])
async def api_polls(limit: int = Query(default=30, gt=0, le=200)):
    return ok(await polls_service.list_polls(limit))


@router.post("/api/poll-now", response_model=UnifiedResponse[bool], dependencies=[Depends(require_access_token)])
async def api_poll_now(request: Request):
    await poller.run_poll(request.app)
    return ok(True)
