"""出参模型：推文 DTO。"""

import json
from typing import Optional

from pydantic import BaseModel, field_validator


class TweetOut(BaseModel):
    """推文 DTO：字段与旧版 main._tweet_dto 完全一致。"""

    id: str
    account: str
    text: str
    url: str
    created_at: str
    source: str
    matched: bool
    rule_name: Optional[str] = None
    matched_terms: list[str] = []
    notified: bool

    @field_validator("matched_terms", mode="before")
    @classmethod
    def _parse_terms(cls, v):
        # 库里存的是 JSON 数组字符串：解析为列表；空/None/解析失败一律视为空数组
        if isinstance(v, str):
            try:
                v = json.loads(v)
            except (TypeError, ValueError):
                return []
        return v or []
