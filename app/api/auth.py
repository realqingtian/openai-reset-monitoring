"""登录鉴权路由：账密换 JWT。"""

import asyncio

from fastapi import APIRouter, Request

from app.core.errors import BizError
from app.core.security import check_credentials, create_access_token
from app.schemas import LoginIn, LoginOut, UnifiedResponse, ok

router = APIRouter()


@router.post("/api/login", response_model=UnifiedResponse[LoginOut])
async def api_login(request: Request, body: LoginIn):
    """管理员登录：账密校验通过后签发 HS256 JWT，前端以 Authorization: Bearer 携带。"""
    cfg = request.app.state.cfg
    if not cfg.auth_enabled:
        raise BizError(404, "未启用登录鉴权：请先在 .env 配置 MONITOR_ADMIN_PASSWORD")
    if not check_credentials(cfg, body.username, body.password):
        # 轻微延缓在线爆破；async sleep 不阻塞事件循环
        await asyncio.sleep(1)
        raise BizError(401, "用户名或密码错误")
    token, expires_at = create_access_token(cfg, body.username.strip())
    return ok(LoginOut(access_token=token, expires_at=expires_at))
