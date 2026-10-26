"""追加账本与人工复核回归；仅使用既有单元测试类型的隔离夹具。"""

import os
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

import httpx
from app.api import event_reviews as reviews_api
from app.core.config import Settings
from app.core.errors import register_exception_handlers
from app.core.timeutil import iso_utc
from app.db import database
from app.repositories import forecast_history, tweets
from app.schemas.event import ResetEventOut
from app.schemas.forecast import ResetForecastOut
from app.services import event_review, events
from app.services.forecast_history import evaluate, history
from fastapi import FastAPI


class HistoryLogic(unittest.TestCase):
    def record(self):
        return {
            "id": "fixture",
            "account": "fixture",
            "created_at": "2030-01-01T00:00:00Z",
            "payload": ResetForecastOut(
                status="estimated", window_start="2030-01-02T00:00:00Z", window_end="2030-01-02T02:00:00Z"
            ).model_dump_json(),
        }

    def test_waits_one_day_and_ignores_cards_other_accounts_and_late_announcements(self):
        record = self.record()
        self.assertIsNone(evaluate(record, [], datetime(2030, 1, 2, 3, tzinfo=timezone.utc)))
        rows = [
            ResetEventOut(
                id="real",
                account="fixture",
                kind="quota",
                phase="completed",
                announced_at="2030-01-02T01:00:00Z",
                updated_at="2030-01-02T01:00:00Z",
                completed_at="2030-01-02T01:00:00Z",
            )
        ]
        now = datetime(2030, 1, 4, tzinfo=timezone.utc)
        self.assertEqual(evaluate(record, rows, now)["outcome"], "within_window")
        for changed in [{"kind": "card"}, {"account": "another"}, {"completed_at": "2030-01-02T03:00:00Z"}]:
            self.assertEqual(evaluate(record, [rows[0].model_copy(update=changed)], now)["outcome"], "outside_window")

    def test_recorded_after_window_started_is_ineligible(self):
        record = self.record()
        record["created_at"] = "2030-01-02T01:00:00Z"
        self.assertEqual(evaluate(record, [], datetime(2030, 1, 4, tzinfo=timezone.utc))["outcome"], "ineligible")


class HistoryReviewStorage(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        temp = tempfile.TemporaryDirectory(prefix="crm-review-unit-", dir="/tmp")
        self.addCleanup(temp.cleanup)
        with patch.dict(os.environ, {}, clear=True):
            self.cfg = Settings(_env_file=None, monitor_cleanup_on_startup=False)
        for name, value in [("DB_PATH", Path(temp.name) / "fixture.db"), ("_engine", None), ("_session_factory", None)]:
            item = patch.object(database, name, value)
            item.start()
            self.addCleanup(item.stop)
        await database.init_db(self.cfg)
        self.app = FastAPI()
        self.app.state.cfg = self.cfg
        register_exception_handlers(self.app)
        self.app.include_router(reviews_api.router)
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=self.app), base_url="https://fixture")
        self.addAsyncCleanup(self.client.aclose)
        for identifier, hours, account in [("a", 24, "fixture"), ("b", 12, "fixture"), ("c", 12, "another")]:
            await tweets.upsert_tweet(
                {
                    "id": identifier,
                    "account": account,
                    "created_at": iso_utc(datetime.now(timezone.utc) - timedelta(hours=hours)),
                    "text": "Usage limits have been reset.",
                    "url": "https://example.org/source",
                    "source": "fixture",
                }
            )
            await tweets.mark_hit(identifier, "fixture", [])

    async def asyncTearDown(self):
        await database.get_engine().dispose()

    async def send(self, action, identifier="a", revision=0, **extra):
        return await self.client.post(
            "/api/admin/event-reviews",
            json=dict(
                action=action, event_id=identifier, expected_revision=revision, reason="fixture review reason", **extra
            ),
        )

    async def test_snapshots_and_evaluations_cannot_be_overwritten_and_small_samples_hide_rate(self):
        row = {
            "id": "s",
            "created_at": "2030-01-01T00:00:00Z",
            "account": "fixture",
            "model": "deterministic",
            "policy_version": "fixture-v1",
            "payload": ResetForecastOut().model_dump_json(),
        }
        await forecast_history.append_snapshot(row)
        await forecast_history.append_snapshot({**row, "model": "changed"})
        evaluation = {
            "snapshot_id": "s",
            "evaluated_at": "2030-01-04T00:00:00Z",
            "outcome": "within_window",
            "evidence_ids": '["a"]',
        }
        await forecast_history.append_evaluation(evaluation)
        await forecast_history.append_evaluation({**evaluation, "outcome": "outside_window"})
        output = await history(10)
        self.assertEqual(output["items"][0]["model"], "deterministic")
        self.assertEqual(output["items"][0]["evaluation"]["outcome"], "within_window")
        self.assertIsNone(output["window_match_rate"])
        await database.init_db(self.cfg)
        self.assertEqual(len(await forecast_history.recent(10)), 1)

    async def test_classify_changes_derived_events_but_not_original_or_delivery(self):
        response = await self.send("classify", kind="card", phase="scheduled")
        self.assertEqual(response.status_code, 200)
        row = next(event for event in await events.all_events(self.cfg) if event.id == "a")
        self.assertEqual((row.kind, row.phase), ("card", "scheduled"))
        original = (await tweets.tweet_page(None, None, identifiers=["a"]))[0]
        self.assertEqual(original["matched"], 1)
        self.assertIn("limits have been reset", original["text"])
        audit = await event_review.audit(50)
        self.assertEqual((audit["revision"], audit["items"][0]["actor"]), (1, self.cfg.monitor_admin_user))
        self.assertIn("before", audit["items"][0]["payload"])

    async def test_withdraw_restore_and_concurrent_revision_conflict(self):
        self.assertEqual((await self.send("withdraw")).status_code, 200)
        self.assertNotIn("a", [event.id for event in await events.all_events(self.cfg)])
        self.assertEqual((await self.send("restore", revision=0)).status_code, 409)
        self.assertEqual((await self.send("restore", revision=1)).status_code, 200)
        self.assertIn("a", [event.id for event in await events.all_events(self.cfg)])
        self.assertEqual(len((await event_review.audit(50))["items"]), 2)

    async def test_manual_merge_and_unmerge_preserve_evidence_and_reject_cross_account(self):
        self.assertEqual((await self.send("merge", target_id="c")).status_code, 400)
        self.assertEqual((await self.send("merge", target_id="b")).status_code, 200)
        result = await events.all_events(self.cfg)
        target = next(row for row in result if row.id == "b")
        self.assertEqual({source.id for source in target.evidence}, {"a", "b"})
        self.assertEqual((await self.send("unmerge", identifier="a", revision=1)).status_code, 200)
        self.assertEqual(len(await events.all_events(self.cfg)), 3)

    async def test_admin_permission_and_validation(self):
        self.cfg.monitor_admin_password = os.urandom(12).hex()
        self.assertEqual((await self.send("withdraw")).status_code, 401)
        self.assertEqual((await self.client.get("/api/admin/event-reviews")).status_code, 401)
        self.cfg.monitor_admin_password = ""
        self.assertEqual((await self.send("classify")).status_code, 400)
        self.assertEqual((await self.send("withdraw", identifier="missing")).status_code, 404)

    async def test_withdrawal_suppresses_retry_and_manual_merge_updates_forecast_samples(self):
        from unittest.mock import AsyncMock

        from app.services import reset_forecast, review_state
        from app.services.notify import dispatch_hit_dedup

        self.assertEqual((await self.send("withdraw")).status_code, 200)
        self.assertIn("a", await review_state.suppressed_ids())
        row = (await tweets.tweet_page(None, None, identifiers=["a"]))[0]
        with patch("app.services.notify.dispatch_hit", AsyncMock()) as sender:
            self.assertFalse(await dispatch_hit_dedup(self.cfg, None, row, {}))
            sender.assert_not_awaited()
        self.assertEqual((await self.send("restore", revision=1)).status_code, 200)
        self.assertEqual((await self.send("merge", target_id="b", revision=2)).status_code, 200)
        rows = await tweets.tweet_page(None, None, identifiers=["a", "b"])
        analysis = reset_forecast.fallback_events(rows)
        collapsed, _ = await review_state.apply_analysis(rows, analysis, collapse_merges=True)
        out = reset_forecast.calculate(rows, collapsed, datetime.now(timezone.utc))
        self.assertEqual(out.sample_events, 1)
