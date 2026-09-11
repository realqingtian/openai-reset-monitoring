"""统一响应包体与出参构造。"""

from typing import Any, Generic, Optional, TypeVar

from pydantic import BaseModel

T = TypeVar("T")


class UnifiedResponse(BaseModel, Generic[T]):
    """统一成功包体：不设 errors 字段，保证成功响应无 errors 键。"""

    code: int = 200
    data: Optional[T] = None
    message: str = "ok"


class ErrorBody(BaseModel):
    """统一异常包体：code 与 HTTP 状态码一致，errors 为详情列表。"""

    code: int
    message: str
    errors: list[Any] = []


def ok(data: Any = None, message: str = "ok") -> UnifiedResponse:
    """成功包裹：code 恒为 200，message 默认 "ok"，返回模型实例（异常包体统一由 errors.py 经 ErrorBody 构造）。"""
    return UnifiedResponse(data=data, message=message)
