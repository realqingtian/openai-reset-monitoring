"""标准文档下载位于 /api 之外，保持业务 JSON 包体契约。"""

from typing import Annotated, Literal, Optional

from fastapi import APIRouter, Query, Request
from fastapi.responses import Response

from app.schemas.event import EventKind
from app.services import events, exports

router = APIRouter()


@router.get("/calendar.ics")
async def calendar_file(
    request: Request,
    limit: int = Query(100, ge=1, le=500),
    kind: Annotated[Optional[EventKind], Query()] = None,
    lang: Literal["zh", "en"] = "en",
):
    rows = await events.all_events(request.app.state.cfg)
    selected = [event for event in rows if kind is None or event.kind == kind][:limit]
    return Response(
        exports.calendar(selected, lang),
        media_type="text/calendar",
        headers={
            "Content-Disposition": 'attachment; filename="reset-announcements.ics"',
            "Cache-Control": "public, max-age=60",
        },
    )


@router.get("/feed.atom")
@router.get("/feed.rss")
async def syndication(
    request: Request,
    limit: int = Query(50, ge=1, le=100),
    kind: Annotated[Optional[EventKind], Query()] = None,
    lang: Literal["zh", "en"] = "en",
):
    rows = await events.all_events(request.app.state.cfg)
    selected = [event for event in rows if kind is None or event.kind == kind][:limit]
    fmt = "atom" if request.url.path.endswith(".atom") else "rss"
    return Response(
        exports.feed(selected, str(request.base_url).rstrip("/"), fmt, lang),
        media_type=f"application/{fmt}+xml",
        headers={"Cache-Control": "public, max-age=60", "X-Content-Type-Options": "nosniff"},
    )
