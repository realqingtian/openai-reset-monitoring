"""可选访问令牌鉴权：MONITOR_ACCESS_TOKEN 未配置时全部放行，保持局域网零配置兼容。

防护对象是会触发动作的写接口（立即检查 / 测试通知）；读接口（面板数据）保持公开，
面板查看不需要登录。令牌经 X-Access-Token 或 Authorization: Bearer 传入，
比较用 compare_digest 防时序侧信道。
"""

import secrets
from typing import Optional

from fastapi import Header, Request

from app.core.errors import BizError


def _extract_token(x_access_token: Optional[str], authorization: Optional[str]) -> str:
    if x_access_token and x_access_token.strip():
        return x_access_token.strip()
    if authorization and authorization.lower().startswith("bearer "):
        return authorization[7:].strip()
    return ""


def require_access_token(
    request: Request,
    x_access_token: Optional[str] = Header(default=None),
    authorization: Optional[str] = Header(default=None),
) -> None:
    expected = (request.app.state.cfg.monitor_access_token or "").strip()
    if not expected:
        return
    supplied = _extract_token(x_access_token, authorization)
    if not supplied or not secrets.compare_digest(supplied, expected):
        raise BizError(401, "需要有效的访问令牌（X-Access-Token 或 Authorization: Bearer）")
