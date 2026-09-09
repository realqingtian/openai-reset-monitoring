"""数据访问层：每个函数自开会话，查询在会话内转 dict 后返回（会话外不再依赖 ORM 对象）。"""
from typing import Any, Dict


def to_dict(obj: Any) -> Dict[str, Any]:
    """ORM 对象 → dict（键为列名；简单属性读取，会话关闭后仍可用）。"""
    return {c.key: getattr(obj, c.key) for c in obj.__table__.columns}
