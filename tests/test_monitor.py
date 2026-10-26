"""新鲜度、投递聚合和管理权限回归；沿用单元测试独立夹具，不写真实业务库。"""

import os
import secrets
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

import httpx
from fastapi import FastAPI

from app.api import monitor as monitor_api
from app.core.config import Settings
from app.core.errors import register_exception_handlers
from app.core.timeutil import iso_utc
from app.db import database
from app.repositories import monitor as monitor_repo
from app.repositories import notifies, polls, tweets
from app.services import monitor


class HealthTests(unittest.TestCase):
    def test_freshness_is_not_a_claim_that_no_reset_occurred(self):
        now = datetime.now(timezone.utc)
        healthy = dict(enabled=True, configured=True, known=True, healthy=True)
        failed = dict(healthy, healthy=False)
        self.assertEqual(monitor.health_state([], None, 600, now), "unconfigured")
        self.assertEqual(monitor.health_state([], None, 600, now, True), "demo")
        self.assertEqual(monitor.health_state([dict(healthy, known=False)], None, 600, now), "waiting")
        self.assertEqual(monitor.health_state([failed], iso_utc(now), 600, now), "offline")
        self.assertEqual(monitor.health_state([healthy], iso_utc(now - timedelta(hours=1)), 600, now), "stale")
        self.assertEqual(monitor.health_state([healthy], iso_utc(now), 600, now), "healthy")
        self.assertEqual(monitor.health_state([healthy, failed], iso_utc(now), 600, now), "degraded")


class MonitorTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        temp = tempfile.TemporaryDirectory(prefix="crm-monitor-unit-", dir="/tmp")
        self.addCleanup(temp.cleanup)
        with patch.dict(os.environ, {}, clear=True):
            self.cfg = Settings(_env_file=None)
        for name, value in (("DB_PATH", Path(temp.name) / "test.db"), ("_engine", None), ("_session_factory", None)):
            p = patch.object(database, name, value)
            p.start()
            self.addCleanup(p.stop)
        await database.init_db(self.cfg)
        self.app = FastAPI()
        self.app.state.cfg = self.cfg
        register_exception_handlers(self.app)
        self.app.include_router(monitor_api.router)
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=self.app), base_url="http://test")
        self.addAsyncCleanup(self.client.aclose)

    async def asyncTearDown(self):
        await database.get_engine().dispose()

    async def add_tweet(self, identifier):
        await tweets.upsert_tweet(
            {
                "id": identifier,
                "account": "fixture",
                "text": "Usage limits have been reset.",
                "url": "https://example.org/announcement",
                "created_at": iso_utc(),
                "source": "fixture",
            }
        )
        await tweets.mark_hit(identifier, "fixture", [])

    async def test_pending_retries_use_latest_per_announcement_across_all_pages(self):
        await self.add_tweet("failed")
        await self.add_tweet("never-attempted")
        await notifies.log_notify("failed", "feishu", False, "upstream failure")
        for _ in range(205):
            await notifies.log_notify("test", "feishu", True)
        result = await monitor_repo.delivery_state(iso_utc(datetime.now(timezone.utc) - timedelta(days=1)), 5)
        self.assertEqual(len(result["recent"]), 5)
        self.assertEqual(result["pending"], {"feishu": 1})
        await notifies.log_notify("failed", "feishu", True)
        self.assertEqual((await monitor_repo.delivery_state("", 5))["pending"], {})

    async def test_ai_miss_and_delivered_posts_are_not_pending(self):
        for identifier in ("miss", "delivered"):
            await self.add_tweet(identifier)
            await notifies.log_notify(identifier, "feishu", False)
        await tweets.save_ai_review("miss", "miss", "Historical discussion")
        await tweets.mark_notified("delivered")
        self.assertEqual((await monitor_repo.delivery_state("", 200))["pending"], {})

    async def test_last_attempt_does_not_replace_last_success(self):
        await polls.log_poll("fixture", "fixture", True)
        success = await monitor_repo.last_successful_poll()
        await polls.log_poll("fixture", "fixture", False)
        self.assertEqual(await monitor_repo.last_successful_poll(), success)

    async def test_development_startup_preserves_expired_history(self):
        old = iso_utc(datetime.now(timezone.utc) - timedelta(days=300))
        await tweets.upsert_tweet(
            {
                "id": "old-fixture",
                "account": "fixture",
                "text": "Historical post",
                "url": "https://example.org/history",
                "created_at": old,
                "source": "fixture",
            }
        )
        self.cfg.monitor_cleanup_on_startup = False
        await database.init_db(self.cfg)
        self.assertIsNotNone(await tweets.get_tweet("old-fixture"))
        self.cfg.monitor_cleanup_on_startup = True
        await database.init_db(self.cfg)
        self.assertIsNone(await tweets.get_tweet("old-fixture"))

    async def test_public_summary_and_protected_admin_contract(self):
        with patch.dict(os.environ, {"MONITOR_ADMIN_PASSWORD": secrets.token_urlsafe(32)}, clear=True):
            self.app.state.cfg = Settings(_env_file=None)
        response = await self.client.get("/api/monitor")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["data"]["state"], "unconfigured")
        self.assertNotIn("deliveries", response.json()["data"])
        self.assertEqual((await self.client.get("/api/admin/monitor")).status_code, 401)
        self.app.state.cfg = self.cfg
        self.assertEqual((await self.client.get("/api/admin/monitor?limit=200")).status_code, 200)
        self.assertEqual((await self.client.get("/api/admin/monitor?limit=201")).status_code, 422)
        self.assertEqual((await self.client.get("/api/admin/monitor?limit=0")).status_code, 422)

    async def test_upstream_errors_do_not_expose_credentials(self):
        secret = secrets.token_urlsafe(32)
        with patch.dict(os.environ, {"FEISHU_WEBHOOK": "https://example.org/" + secret}, clear=True):
            cfg = Settings(_env_file=None)
        await notifies.log_notify("test", "feishu", False, cfg.feishu_webhook + " Bearer " + secret)
        result = await monitor.admin_details(cfg)
        self.assertNotIn(secret, result.model_dump_json())
        self.assertNotIn(cfg.feishu_webhook, result.model_dump_json())
