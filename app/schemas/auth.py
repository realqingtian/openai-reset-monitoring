"""出参入参模型：/api/login 登录签发 JWT。"""

from pydantic import BaseModel, Field


class LoginIn(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=128)


class LoginOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_at: str  # 过期时间 UTC ISO，前端可据此提前提示重新登录
