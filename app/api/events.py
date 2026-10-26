"""独立事件列表：分类在分页之前应用，原始证据始终保留。"""

from typing import Annotated, Optional

from fastapi import APIRouter, Query, Request

from app.schemas.common import UnifiedResponse, ok
from app.schemas.event import EventKind, EventPageOut, EventPhase
from app.services import events

router = APIRouter()


@router.get("/api/events", response_model=UnifiedResponse[EventPageOut])
async def event_page(
    request: Request,
    limit: int = Query(default=20, gt=0, le=100),
    before: Optional[str] = Query(default=None, min_length=1, max_length=512),
    kind: Annotated[Optional[EventKind], Query()] = None,
    phase: Annotated[Optional[EventPhase], Query()] = None,
    account: Optional[str] = Query(default=None, min_length=1, max_length=100),
):
    return ok(await events.page(request.app.state.cfg, limit, before, kind, phase, account))
