"""访客订阅使用独立确认与管理能力，不需要也不授予管理员权限。"""

import time
from collections import defaultdict, deque
from typing import Literal

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, ConfigDict, Field

from app.core.errors import BizError
from app.schemas.common import ok
from app.services import subscriptions

router = APIRouter()
_requests: dict = defaultdict(deque)


def protect(request: Request):
    origin = request.headers.get("origin")
    if origin and origin.rstrip("/") != str(request.base_url).rstrip("/"):
        raise BizError(403, "不允许跨站订阅请求")
    now = time.monotonic()
    key = (request.client.host if request.client else "unknown", request.url.path)
    if len(_requests) > 1000:
        for previous in list(_requests):
            if not _requests[previous] or _requests[previous][-1] < now - 3600:
                del _requests[previous]
        if len(_requests) > 1000:
            raise BizError(429, "请求较多，请稍后重试")
    queue = _requests[key]
    window, maximum = (3600, 5) if request.url.path.endswith("/email") else (60, 30)
    while queue and queue[0] < now - window:
        queue.popleft()
    if len(queue) >= maximum:
        raise BizError(429, "请求过于频繁，请稍后重试")
    queue.append(now)


class Preferences(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kinds: list[Literal["quota", "card"]] = Field(min_length=1, max_length=2)
    phases: list[Literal["completed", "scheduled"]] = Field(min_length=1, max_length=2)
    lang: Literal["zh", "en"] = "zh"


class EmailInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    email: str = Field(
        min_length=3,
        max_length=254,
        pattern=r"^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}$",
    )
    preferences: Preferences
    consent: Literal[True]


class PushKeys(BaseModel):
    model_config = ConfigDict(extra="forbid")
    p256dh: str = Field(min_length=80, max_length=100)
    auth: str = Field(min_length=20, max_length=30)


class PushData(BaseModel):
    model_config = ConfigDict(extra="forbid")
    endpoint: str = Field(min_length=10, max_length=4096)
    keys: PushKeys


class PushInput(BaseModel):
    subscription: PushData
    preferences: Preferences
    consent: Literal[True]


class TokenInput(BaseModel):
    token: str = Field(min_length=40, max_length=300, pattern=r"^[A-Za-z0-9_.-]+$")


class PreferencesInput(TokenInput):
    preferences: Preferences


@router.get("/api/subscriptions/options")
async def options(request: Request):
    return ok(subscriptions.readiness(request.app.state.cfg))


@router.post("/api/subscriptions/email", dependencies=[Depends(protect)])
async def subscribe_email(request: Request, body: EmailInput):
    return ok(
        await subscriptions.subscribe(request.app.state.cfg, "email", body.email.lower(), body.preferences.model_dump())
    )


@router.post("/api/subscriptions/webpush", dependencies=[Depends(protect)])
async def subscribe_push(request: Request, body: PushInput):
    import json

    destination = json.dumps(subscriptions.valid_push(body.subscription.model_dump()), sort_keys=True)
    return ok(
        await subscriptions.subscribe(request.app.state.cfg, "webpush", destination, body.preferences.model_dump())
    )


@router.post("/api/subscriptions/confirm", dependencies=[Depends(protect)])
async def confirm(request: Request, body: TokenInput):
    return ok(await subscriptions.confirm(request.app.state.cfg, body.token))


@router.post("/api/subscriptions/manage", dependencies=[Depends(protect)])
async def manage(request: Request, body: TokenInput):
    return ok(await subscriptions.manage(request.app.state.cfg, body.token))


@router.post("/api/subscriptions/preferences", dependencies=[Depends(protect)])
async def preferences(request: Request, body: PreferencesInput):
    return ok(await subscriptions.manage(request.app.state.cfg, body.token, body.preferences.model_dump()))


@router.post("/api/subscriptions/unsubscribe", dependencies=[Depends(protect)])
async def unsubscribe(request: Request, body: TokenInput):
    return ok(await subscriptions.manage(request.app.state.cfg, body.token, unsubscribe=True))
