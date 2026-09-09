"""出参模型：翻译结果 DTO。"""
from typing import Optional

from pydantic import BaseModel


class TranslateOut(BaseModel):
    """翻译结果：兼容缓存命中 / 新翻译 / same 三种形态（None 照常输出 null）。"""
    id: str
    to: str
    text: Optional[str] = None
    provider: Optional[str] = None
    cached: Optional[bool] = None
    same: Optional[bool] = None
    source: Optional[str] = None
