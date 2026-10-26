"""访客订阅不访问真实邮箱或浏览器推送；覆盖确认、退订、去重与权限边界。"""

import base64
import json
import os
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import AsyncMock, patch

import httpx
from app.api import mcp
from app.api import subscriptions as subscription_api
from app.core.config import Settings
from app.core.errors import BizError, register_exception_handlers
from app.core.timeutil import iso_utc
from app.db import database
from app.repositories import subscriptions as repository
from app.schemas.event import ResetEventOut
from app.schemas.tweet import TweetOut
from app.services import subscriptions
from fastapi import FastAPI

PREFERENCES = {"kinds": ["quota"], "phases": ["completed"], "lang": "en"}


class PublicIntegrations(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        directory = tempfile.TemporaryDirectory(prefix="crm-public-unit-", dir="/tmp")
        self.addCleanup(directory.cleanup)
        with patch.dict(os.environ, {}, clear=True):
            self.cfg = Settings(
                _env_file=None,
                monitor_cleanup_on_startup=False,
                monitor_public_subscriptions=True,
                monitor_public_base_url="https://fixture.invalid",
                monitor_subscription_secret=os.urandom(32).hex(),
                monitor_smtp_host="localhost",
                monitor_smtp_from="fixture@Testerflight.com",
                monitor_smtp_starttls=False,
            )
        for name, value in [
            ("DB_PATH", Path(directory.name) / "fixture.db"),
            ("_engine", None),
            ("_session_factory", None),
        ]:
            item = patch.object(database, name, value)
            item.start()
            self.addCleanup(item.stop)
        await database.init_db(self.cfg)
        self.app = FastAPI()
        self.app.state.cfg = self.cfg
        register_exception_handlers(self.app)
        self.app.include_router(subscription_api.router)
        self.app.include_router(mcp.router)
        subscription_api._requests.clear()
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=self.app), base_url="https://fixture.invalid")
        self.addAsyncCleanup(self.client.aclose)
        sender = patch(
            "app.services.subscriptions.public_notifications.send_email", AsyncMock(return_value=(True, None))
        )
        self.mail = sender.start()
        self.addCleanup(sender.stop)

    async def asyncTearDown(self):
        await database.get_engine().dispose()

    async def confirmed(self):
        result = await subscriptions.subscribe(self.cfg, "email", "fixture@Testerflight.com", PREFERENCES)
        self.assertEqual(result, {"confirmation_required": True})
        link = self.mail.call_args.args[3].splitlines()[-1]
        token = link.split("#email-confirm=", 1)[1]
        return (await subscriptions.confirm(self.cfg, token))["token"], token

    async def test_email_is_pending_until_one_time_confirmation_and_destination_not_public(self):
        token, confirm = await self.confirmed()
        data = await subscriptions.manage(self.cfg, token)
        self.assertTrue(data["active"])
        self.assertNotIn("destination", data)
        with self.assertRaises(BizError):
            await subscriptions.confirm(self.cfg, confirm)
        with self.assertRaises(BizError):
            await subscriptions.manage(self.cfg, token[:-2] + "00")

    async def test_preferences_and_unsubscribe_revoke_old_management_token(self):
        token, _ = await self.confirmed()
        prefs = {**PREFERENCES, "kinds": ["card"]}
        self.assertEqual((await subscriptions.manage(self.cfg, token, prefs))["preferences"], prefs)
        self.assertEqual(await subscriptions.manage(self.cfg, token, unsubscribe=True), {"active": False})
        with self.assertRaises(BizError):
            await subscriptions.manage(self.cfg, token)
        self.assertFalse(await repository.active())

    async def test_confirmation_expiry_and_hourly_resend_limit(self):
        await subscriptions.subscribe(self.cfg, "email", "fixture@Testerflight.com", PREFERENCES)
        await subscriptions.subscribe(self.cfg, "email", "fixture@Testerflight.com", PREFERENCES)
        self.assertEqual(self.mail.await_count, 1)
        token = self.mail.call_args.args[3].split("#email-confirm=", 1)[1]
        identifier = token.split(".", 1)[0]
        row = await repository.by_id(identifier)
        row["confirmation_at"] = iso_utc(datetime.now(timezone.utc) - timedelta(days=2))
        await repository.save(row)
        with self.assertRaises(BizError):
            await subscriptions.confirm(self.cfg, token)

    async def test_queue_deduplicates_and_failed_delivery_retries_without_replaying_accepted(self):
        token, _ = await self.confirmed()
        now = iso_utc(datetime.now(timezone.utc) + timedelta(seconds=1))
        event = ResetEventOut(
            id="announcement",
            account="fixture",
            kind="quota",
            phase="completed",
            announced_at=now,
            updated_at=now,
            completed_at=now,
            evidence=[
                TweetOut(
                    id="announcement",
                    account="fixture",
                    created_at=now,
                    text="Reset completed",
                    url="https://example.org/",
                    source="fixture",
                    matched=1,
                    notified=0,
                )
            ],
        )
        with patch("app.services.subscriptions.events.all_events", AsyncMock(return_value=[event])):
            await subscriptions.queue_events(self.cfg)
            await subscriptions.queue_events(self.cfg)
        row = await repository.by_id(token.split(".")[0])
        self.assertEqual(len(await repository.recent(row["id"])), 1)
        self.mail.return_value = (False, "simulated")
        self.assertTrue(await subscriptions.deliver_one(self.cfg))
        self.assertEqual((await repository.recent(row["id"]))[0]["state"], "retry")
        self.assertFalse(await subscriptions.deliver_one(self.cfg))

    async def test_unsubscribe_stops_pending_delivery_and_empty_history_not_replayed(self):
        token, _ = await self.confirmed()
        row = await repository.by_id(token.split(".")[0])
        now = iso_utc(datetime.now(timezone.utc))
        await repository.enqueue(
            {
                "id": "job",
                "subscription_id": row["id"],
                "event_key": "fixture",
                "payload": "{}",
                "state": "pending",
                "attempts": 0,
                "next_attempt_at": now,
                "created_at": now,
                "updated_at": now,
                "error": None,
            }
        )
        await subscriptions.manage(self.cfg, token, unsubscribe=True)
        count = self.mail.await_count
        self.assertTrue(await subscriptions.deliver_one(self.cfg))
        self.assertEqual(self.mail.await_count, count)
        self.assertEqual((await repository.recent(row["id"]))[0]["state"], "stopped")

    async def test_invalid_push_endpoints_cannot_target_internal_network_or_arbitrary_sites(self):
        keys = {
            "p256dh": base64.urlsafe_b64encode(b"\x04" + os.urandom(64)).decode().rstrip("="),
            "auth": base64.urlsafe_b64encode(os.urandom(16)).decode().rstrip("="),
        }
        for endpoint in [
            "http://127.0.0.1/",
            "https://example.org/",
            "https://fcm.googleapis.com.evil.invalid/",
            "https://user@fcm.googleapis.com/",
            "https://fcm.googleapis.com:9999/",
        ]:
            with self.assertRaises(BizError):
                subscriptions.valid_push({"endpoint": endpoint, "keys": keys})
        self.assertEqual(
            subscriptions.valid_push({"endpoint": "https://fcm.googleapis.com/send/fixture", "keys": keys})["keys"],
            keys,
        )

    async def test_explicit_consent_origin_and_channel_readiness(self):
        body = {"email": "fixture@Testerflight.com", "preferences": PREFERENCES, "consent": False}
        self.assertEqual((await self.client.post("/api/subscriptions/email", json=body)).status_code, 422)
        body["consent"] = True
        self.assertEqual(
            (
                await self.client.post(
                    "/api/subscriptions/email", json=body, headers={"Origin": "https://elsewhere.invalid"}
                )
            ).status_code,
            403,
        )
        self.cfg.monitor_public_subscriptions = False
        self.assertEqual((await self.client.post("/api/subscriptions/email", json=body)).status_code, 503)
        data = (await self.client.get("/api/subscriptions/options")).json()["data"]
        self.assertFalse(data["email"])
        self.assertIsNone(data["vapid_public_key"])

    async def test_mcp_initialization_tools_and_no_write_or_bad_arguments(self):
        async def call(method, params=None):
            return await self.client.post(
                "/mcp", json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params or {}}
            )

        initialized = (await call("initialize")).json()
        self.assertEqual(initialized["result"]["protocolVersion"], "2025-11-25")
        listed = (await call("tools/list")).json()["result"]["tools"]
        self.assertTrue(all(tool["annotations"]["readOnlyHint"] for tool in listed))
        self.assertEqual((await call("tools/call", {"name": "poll-now"})).json()["error"]["code"], -32602)
        self.assertEqual(
            (await call("tools/call", {"name": "get_reset_events", "arguments": {"limit": 1000}})).json()["error"][
                "code"
            ],
            -32602,
        )
        self.assertEqual(
            (
                await self.client.post("/mcp", json={"jsonrpc": "2.0", "method": "notifications/initialized"})
            ).status_code,
            202,
        )
        self.assertEqual((await self.client.get("/mcp")).status_code, 405)
        self.assertEqual(
            (await self.client.post("/mcp", json={}, headers={"Origin": "https://elsewhere.invalid"})).status_code, 403
        )

    async def test_management_revision_prevents_revoked_token_from_reactivating_subscription(self):
        token, _ = await self.confirmed()
        row = await repository.by_id(token.split(".")[0])
        await subscriptions.manage(self.cfg, token, unsubscribe=True)
        changed = await repository.change(row["id"], {"active": True}, row["generation"])
        self.assertFalse(changed)
        self.assertFalse((await repository.by_id(row["id"]))["active"])

    async def test_successful_delivery_is_not_replayed_and_preferences_are_checked_again(self):
        token, _ = await self.confirmed()
        row = await repository.by_id(token.split(".")[0])
        now = iso_utc(datetime.now(timezone.utc))
        payload = {
            "title": "fixture announcement",
            "body": "fixture",
            "url": "https://example.org/",
            "kind": "quota",
            "phase": "completed",
            "source_ids": ["fixture"],
        }
        job = {
            "id": "accepted-job",
            "subscription_id": row["id"],
            "event_key": "accepted",
            "payload": json.dumps(payload),
            "state": "pending",
            "attempts": 0,
            "next_attempt_at": now,
            "created_at": now,
            "updated_at": now,
            "error": None,
        }
        await repository.enqueue(job)
        await repository.enqueue(job)
        baseline = self.mail.await_count
        self.assertTrue(await subscriptions.deliver_one(self.cfg))
        self.assertFalse(await subscriptions.deliver_one(self.cfg))
        self.assertEqual(self.mail.await_count, baseline + 1)
        self.assertEqual((await repository.recent(row["id"]))[0]["state"], "delivered")
        await repository.enqueue({**job, "id": "pref-job", "event_key": "new-event"})
        await subscriptions.manage(self.cfg, token, {**PREFERENCES, "kinds": ["card"]})
        await subscriptions.deliver_one(self.cfg)
        self.assertEqual(self.mail.await_count, baseline + 1)

    async def test_resubscribe_does_not_replay_events_before_reactivation(self):
        token, _ = await self.confirmed()
        identifier = token.split(".")[0]
        row = await repository.by_id(identifier)
        row["confirmation_at"] = iso_utc(datetime.now(timezone.utc) - timedelta(hours=2))
        await repository.save(row)
        await subscriptions.manage(self.cfg, token, unsubscribe=True)
        _, _ = await self.confirmed()
        row = await repository.by_id(identifier)
        self.assertGreaterEqual(row["active_since"], row["created_at"])
        old = iso_utc(datetime.now(timezone.utc) - timedelta(minutes=1))
        event = ResetEventOut(
            id="old",
            account="fixture",
            kind="quota",
            phase="completed",
            announced_at=old,
            updated_at=old,
            completed_at=old,
        )
        with patch("app.services.subscriptions.events.all_events", AsyncMock(return_value=[event])):
            await subscriptions.queue_events(self.cfg)
        self.assertFalse(await repository.recent(identifier))

    async def test_mcp_returns_only_read_data_and_hides_exception_details(self):
        async def call():
            return await self.client.post(
                "/mcp",
                json={
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "tools/call",
                    "params": {"name": "get_monitor_status", "arguments": {}},
                },
            )

        with patch("app.api.mcp.monitor.summary", AsyncMock(side_effect=RuntimeError("private fixture detail"))):
            response = await call()
            self.assertTrue(response.json()["result"]["isError"])
            self.assertNotIn("private fixture detail", response.text)
        self.assertEqual(
            (
                await self.client.post("/mcp", content=b"x" * 16385, headers={"Content-Type": "application/json"})
            ).status_code,
            413,
        )

    async def test_email_transport_verifies_tls_certificates_in_both_modes(self):
        import ssl

        from app.integrations.public_notifications import _mail

        with patch("smtplib.SMTP") as smtp:
            self.cfg.monitor_smtp_starttls = True
            _mail(self.cfg, "fixture@Testerflight.com", "fixture", "fixture")
            context = smtp.return_value.__enter__.return_value.starttls.call_args.kwargs["context"]
            self.assertTrue(context.check_hostname)
            self.assertEqual(context.verify_mode, ssl.CERT_REQUIRED)
        with patch("smtplib.SMTP_SSL") as smtp:
            self.cfg.monitor_smtp_ssl = True
            _mail(self.cfg, "fixture@Testerflight.com", "fixture", "fixture")
            context = smtp.call_args.kwargs["context"]
            self.assertTrue(context.check_hostname)
            self.assertEqual(context.verify_mode, ssl.CERT_REQUIRED)
            smtp.return_value.__enter__.return_value.starttls.assert_not_called()
