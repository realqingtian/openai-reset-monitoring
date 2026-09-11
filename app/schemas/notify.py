"""出参模型：测试通知结果 DTO。"""

from typing import Optional

from pydantic import BaseModel


class TestNotifyResult(BaseModel):
    """单个通知渠道的测试发送结果。"""

    channel: str
    ok: bool
    error: Optional[str] = None
