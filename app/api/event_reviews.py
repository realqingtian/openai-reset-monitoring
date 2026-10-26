"""复核写入与审计读接口统一要求操作权限。"""

from typing import Literal, Optional

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, Field, field_validator

from app.core.security import require_login
from app.schemas.common import ok
from app.schemas.event import EventKind, EventPhase
from app.services import event_review

router = APIRouter()


class ReviewInput(BaseModel):
    action: Literal["classify", "merge", "unmerge", "withdraw", "restore"]
    event_id: str = Field(min_length=1, max_length=200)
    target_id: Optional[str] = Field(default=None, max_length=200)
    kind: Optional[EventKind] = None
    phase: Optional[EventPhase] = None
    expected_revision: int = Field(ge=0)
    reason: str = Field(min_length=3, max_length=500)

    @field_validator("reason")
    @classmethod
    def nonblank(cls, value: str) -> str:
        if len(value.strip()) < 3:
            raise ValueError("请填写具体复核原因")
        return value.strip()


@router.get("/api/admin/event-reviews", dependencies=[Depends(require_login)])
async def audit(limit: int = Query(50, gt=0, le=200)):
    return ok(await event_review.audit(limit))


@router.post("/api/admin/event-reviews")
async def review(request: Request, body: ReviewInput, actor: str = Depends(require_login)):
    return ok(await event_review.submit(request.app.state.cfg, body, actor))
