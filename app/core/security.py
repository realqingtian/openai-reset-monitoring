"""JWT 登录鉴权：单管理员账密（env 配置）换取 Bearer Token，HS256 签发与校验。

口径与项目「填了即启用，留空即停用」的约定一致：MONITOR_ADMIN_PASSWORD 未配置时
鉴权整体关闭，一切匿名放行；配置后读接口保持公开（面板匿名可看），写操作需登录。
decode 显式锁定 HS256 算法白名单，杜绝 alg 混淆类攻击；密钥未显式配置时从管理员
口令派生（重启不掉 token，改口令即全量失效）。
"""

import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

import jwt
from fastapi import Header, Request

from app.core.errors import BizError
from app.core.timeutil import iso_utc

_ALGO = "HS256"


def create_access_token(cfg, username: str) -> tuple[str, str]:
    """签发 JWT，返回 (token, 过期时间 ISO 字符串)。"""
    now = datetime.now(timezone.utc)
    expire = now + timedelta(hours=cfg.monitor_token_expire_hours)
    payload = {"sub": username, "iat": now, "exp": expire}
    return jwt.encode(payload, cfg.jwt_secret, algorithm=_ALGO), iso_utc(expire)


def bearer_identity(cfg, authorization: Optional[str]) -> Optional[str]:
    """校验 Authorization: Bearer 头。合法返回用户名；未配置鉴权/头缺失/token 非法或过期返回 None。"""
    if not cfg.auth_enabled or not authorization or not authorization.lower().startswith("bearer "):
        return None
    token = authorization[7:].strip()
    if not token:
        return None
    try:
        payload = jwt.decode(token, cfg.jwt_secret, algorithms=[_ALGO])
    except jwt.PyJWTError:
        return None
    sub = payload.get("sub")
    return str(sub) if sub else None


def check_credentials(cfg, username: Optional[str], password: Optional[str]) -> bool:
    """账密校验：常量时间比较，避免时序侧信道。"""
    if not cfg.auth_enabled:
        return False
    ok_user = secrets.compare_digest((username or "").strip(), cfg.monitor_admin_user.strip())
    ok_pass = secrets.compare_digest(password or "", cfg.monitor_admin_password)
    return ok_user and ok_pass


def require_login(request: Request, authorization: Optional[str] = Header(default=None)) -> str:
    """保护性依赖：未登录（或 token 失效）一律 401，走统一异常包体。"""
    user = bearer_identity(request.app.state.cfg, authorization)
    if not user:
        raise BizError(401, "需要登录（Authorization: Bearer <token>，经 POST /api/login 获取）")
    return user


def optional_login(request: Request, authorization: Optional[str] = Header(default=None)) -> Optional[str]:
    """宽松依赖：返回登录用户名或 None，供「匿名降级」的读接口（如 24h 窗口钳制）使用。"""
    return bearer_identity(request.app.state.cfg, authorization)
