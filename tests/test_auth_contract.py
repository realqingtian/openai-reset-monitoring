"""操作鉴权契约回归：只使用内存 ASGI 应用和运行时生成的测试凭证。"""

import os
import secrets
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import httpx
import jwt
from fastapi import FastAPI

from app.api import auth, polls
from app.core.config import Settings
from app.core.errors import register_exception_handlers
from app.core.security import create_access_token


class AuthContractTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        with patch.dict(os.environ, {}, clear=True):
            self.cfg = Settings(_env_file=None)
        self.app = FastAPI()
        self.app.state.cfg = self.cfg
        register_exception_handlers(self.app)
        self.app.include_router(auth.router)
        self.app.include_router(polls.router)
        self.poll = AsyncMock(return_value={"ok": True})
        p = patch("app.api.polls.poller.run_poll", self.poll)
        p.start()
        self.addCleanup(p.stop)
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=self.app), base_url="http://test")
        self.addAsyncCleanup(self.client.aclose)

    def enable_auth(self):
        with patch.dict(os.environ, {"MONITOR_ADMIN_PASSWORD": secrets.token_urlsafe(32)}, clear=True):
            self.cfg = Settings(_env_file=None)
        self.app.state.cfg = self.cfg

    async def test_empty_password_allows_operation_without_login(self):
        response = await self.client.post("/api/poll-now")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["data"])
        self.poll.assert_awaited_once()
        login = await self.client.post(
            "/api/login", json={"username": self.cfg.monitor_admin_user, "password": secrets.token_urlsafe(16)}
        )
        self.assertEqual(login.status_code, 404)

    async def test_enabled_password_rejects_missing_identity(self):
        self.enable_auth()
        self.assertEqual((await self.client.post("/api/poll-now")).status_code, 401)
        self.poll.assert_not_awaited()

    async def test_valid_login_can_perform_operation(self):
        self.enable_auth()
        login = await self.client.post(
            "/api/login", json={"username": self.cfg.monitor_admin_user, "password": self.cfg.monitor_admin_password}
        )
        self.assertEqual(login.status_code, 200)
        response = await self.client.post(
            "/api/poll-now", headers={"Authorization": "Bearer " + login.json()["data"]["access_token"]}
        )
        self.assertEqual(response.status_code, 200)
        self.poll.assert_awaited_once()

    async def test_expired_and_wrong_algorithm_tokens_cannot_perform_operation(self):
        self.enable_auth()
        now = datetime.now(timezone.utc)
        for expiry, algorithm in ((now - timedelta(seconds=1), "HS256"), (now + timedelta(hours=1), "HS384")):
            token = jwt.encode({"sub": self.cfg.monitor_admin_user, "exp": expiry}, self.cfg.jwt_secret, algorithm)
            response = await self.client.post("/api/poll-now", headers={"Authorization": "Bearer " + token})
            self.assertEqual(response.status_code, 401)
        self.poll.assert_not_awaited()

    async def test_changing_password_invalidates_previous_token(self):
        self.enable_auth()
        token, _ = create_access_token(self.cfg, self.cfg.monitor_admin_user)
        self.enable_auth()
        response = await self.client.post("/api/poll-now", headers={"Authorization": "Bearer " + token})
        self.assertEqual(response.status_code, 401)
        self.poll.assert_not_awaited()
