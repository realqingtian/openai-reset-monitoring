"""出参模型：检查日志 DTO。"""
from typing import Optional

from pydantic import BaseModel


class PollOut(BaseModel):
    """检查日志 DTO：ok 由库中 0/1 整数宽松转换为 bool。"""
    id: int
    ts: str
    account: str
    source: str
    ok: bool
    new_tweets: int
    error: Optional[str] = None
    latency_ms: Optional[int] = None
