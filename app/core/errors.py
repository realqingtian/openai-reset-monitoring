"""业务异常与全局异常处理：所有 /api/* 错误统一为 {code, message, errors} 包体。"""
import logging
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.schemas import ErrorBody

log = logging.getLogger("errors")


class BizError(Exception):
    """业务异常：code 即 HTTP 状态码（400/403/404/502 等），message 为可读标题，errors 为详情列表。"""

    def __init__(self, code: int, message: str, errors: Optional[List[Any]] = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.errors = list(errors or [])


def register_exception_handlers(app: FastAPI):
    """在应用上注册统一异常处理（异常时 HTTP 状态码与 body.code 一致）。"""

    @app.exception_handler(BizError)
    async def _on_biz(request: Request, exc: BizError):
        body = ErrorBody(code=exc.code, message=exc.message, errors=exc.errors)
        return JSONResponse(content=body.model_dump(), status_code=exc.code)

    @app.exception_handler(RequestValidationError)
    async def _on_validation(request: Request, exc: RequestValidationError):
        errors = [{"loc": [str(x) for x in e.get("loc", ())],
                   "msg": e.get("msg", ""), "type": e.get("type", "")}
                  for e in exc.errors()]
        body = ErrorBody(code=422, message="请求参数校验失败", errors=errors)
        return JSONResponse(content=body.model_dump(), status_code=422)

    @app.exception_handler(StarletteHTTPException)
    async def _on_http(request: Request, exc: StarletteHTTPException):
        detail = exc.detail if isinstance(exc.detail, str) else "请求无法处理"
        body = ErrorBody(code=exc.status_code, message=detail)
        return JSONResponse(content=body.model_dump(), status_code=exc.status_code)

    @app.exception_handler(Exception)
    async def _on_unexpected(request: Request, exc: Exception):
        # 兜底：未预期异常统一 500 包体，完整堆栈进日志
        log.exception("未处理异常：%s %s", request.method, request.url.path)
        body = ErrorBody(code=500, message="服务器内部错误")
        return JSONResponse(content=body.model_dump(), status_code=500)
