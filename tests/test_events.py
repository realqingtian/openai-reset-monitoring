"""事件归组与完整数据筛选回归，不调用外部模型、不写实际业务数据。"""

import os
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import AsyncMock, patch

import httpx
from app.api import events as events_api
from app.api import tweets as tweets_api
from app.core.config import Settings
from app.core.errors import register_exception_handlers
from app.core.timeutil import iso_utc
from app.db import database
from app.repositories import tweets
from app.services import events
from fastapi import FastAPI


def announcement(identifier, published, text="Usage limits have been reset.", account="fixture", matched=True):
    return {
        "id": identifier,
        "account": account,
        "text": text,
        "url": "https://example.org/announcement",
        "created_at": iso_utc(published),
        "source": "fixture",
        "matched": int(matched),
        "matched_terms": "[]",
        "notified": 0,
    }


class EventGroupingTests(unittest.TestCase):
    def test_untimed_day_pledge_automatically_updates_when_completion_arrives(self):
        start = datetime.now(timezone.utc) - timedelta(hours=5)
        rows = [announcement("pledge", start, "Today is a reset.")]
        cached = [{"id": "pledge", "kind": "quota", "phase": "completed"}]
        initial = events.group_events(rows, events.classify(rows, cached))
        self.assertEqual(initial[0].phase, "scheduled")
        rows.append(announcement("done", start + timedelta(hours=3), "All propagated. Enjoy."))
        updated = events.group_events(rows, events.classify(rows, cached))
        self.assertEqual(len(updated), 1)
        self.assertEqual((updated[0].id, updated[0].phase), ("pledge", "completed"))
        self.assertEqual([source.id for source in updated[0].evidence], ["pledge", "done"])
        self.assertEqual(updated[0].completed_at, rows[1]["created_at"])

    def test_ambiguous_day_pledges_do_not_block_automatic_completion_record(self):
        start = datetime.now(timezone.utc) - timedelta(hours=5)
        rows = [announcement("a", start, "Today is a reset."), announcement("b", start + timedelta(hours=1), "Reset day today.")]
        rows.append(announcement("done", start + timedelta(hours=3)))
        cached = [{"id": identifier, "kind": "quota", "phase": "scheduled"} for identifier in ("a", "b")]
        result = events.group_events(rows, events.classify(rows, cached))
        self.assertEqual(len(result), 3)
        self.assertEqual(sum(event.phase == "completed" for event in result), 1)

    def test_day_pledge_is_a_preview_without_ai_and_does_not_link_other_accounts_or_old_pledges(self):
        start = datetime.now(timezone.utc) - timedelta(days=3)
        rows = [announcement("old", start, "Today is a reset.")]
        rows.append(announcement("other", start + timedelta(days=2), "Today is a reset.", account="another-account"))
        rows.append(announcement("done", start + timedelta(days=2, hours=3)))
        metadata = events.classify(rows, [])
        self.assertEqual(metadata["old"]["phase"], "scheduled")
        result = events.group_events(rows, metadata)
        self.assertEqual(len(result), 3)
        self.assertEqual(sum(event.phase == "completed" for event in result), 1)

    def test_reset_day_pledge_is_not_completion_even_with_old_ai_cache(self):
        start = datetime.now(timezone.utc) - timedelta(hours=1)
        rows = [announcement("pledge", start, "Day 21/ But today is a reset.")]
        cached = [{"id": "pledge", "kind": "quota", "phase": "completed"}]
        result = events.group_events(rows, events.classify(rows, cached))
        self.assertEqual(result[0].phase, "scheduled")
        self.assertIsNone(result[0].completed_at)
        self.assertEqual(cached[0]["phase"], "completed")

    def test_explicit_completion_in_reset_day_post_is_preserved(self):
        start = datetime.now(timezone.utc) - timedelta(hours=1)
        rows = [announcement("done", start, "Today is a reset. All propagated.")]
        cached = [{"id": "done", "kind": "quota", "phase": "completed"}]
        self.assertEqual(events.classify(rows, cached)["done"]["phase"], "completed")

    def test_manual_completion_is_not_overridden_by_reset_day_guard(self):
        start = datetime.now(timezone.utc) - timedelta(hours=1)
        rows = [announcement("reviewed", start, "It is reset day today.")]
        reviewed = [{"id": "reviewed", "kind": "quota", "phase": "completed", "manual": True}]
        self.assertEqual(events.classify(rows, reviewed)["reviewed"]["phase"], "completed")

    def test_quoted_confirmation_links_preview_and_preserves_all_sources(self):
        start = datetime.now(timezone.utc) - timedelta(days=1)
        rows = [
            announcement("preview", start, "Global reset by midnight PST"),
            announcement("done", start + timedelta(hours=8), "All propagated. Tibo: Global reset by midnight PST"),
            announcement("followup", start + timedelta(hours=9)),
        ]
        result = events.group_events(rows, events.classify(rows, []))
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].id, "preview")
        self.assertEqual(result[0].phase, "completed")
        self.assertEqual([s.id for s in result[0].evidence], ["preview", "done", "followup"])
        self.assertEqual(result[0].completed_at, rows[1]["created_at"])

    def test_card_followup_with_explicit_quote_links_even_when_both_marked_complete(self):
        start = datetime.now(timezone.utc) - timedelta(days=2)
        body = "Loading a banked reset into all paid accounts."
        rows = [
            announcement("card", start, body),
            announcement("confirm", start + timedelta(hours=10), "Confirmed landed. Tibo: " + body),
        ]
        analysis = [{"id": row["id"], "kind": "card", "phase": "completed"} for row in rows]
        grouped = events.group_events(rows, events.classify(rows, analysis))
        self.assertEqual(len(grouped), 1)
        self.assertEqual(len(grouped[0].evidence), 2)
        self.assertEqual(grouped[0].completed_at, rows[1]["created_at"])
        self.assertEqual(grouped[0].evidence[0].phase, "scheduled")
        manual = [{**analysis[0], "manual": True}]
        self.assertEqual(events.classify(rows[:1], manual)["card"]["phase"], "completed")

    def test_card_and_accounts_never_merge_into_global_reset(self):
        start = datetime.now(timezone.utc) - timedelta(days=1)
        rows = [
            announcement("quota", start),
            announcement("card", start, "Banked reset available"),
            announcement("another-account", start, account="other"),
        ]
        result = events.group_events(rows, events.classify(rows, []))
        self.assertEqual(len(result), 3)
        self.assertEqual(sum(e.kind == "card" for e in result), 1)

    def test_ambiguous_previews_are_not_guessed_into_one_event(self):
        start = datetime.now(timezone.utc) - timedelta(days=1)
        rows = [
            announcement("a", start, "Reset tomorrow"),
            announcement("b", start, "Reset tonight"),
            announcement("done", start + timedelta(hours=8)),
        ]
        analysis = [
            {
                "id": i,
                "kind": "quota",
                "phase": "scheduled",
                "explicit": True,
                "start": iso_utc(start + timedelta(hours=6)),
                "end": iso_utc(start + timedelta(hours=10)),
            }
            for i in ["a", "b"]
        ]
        result = events.group_events(rows, events.classify(rows, analysis))
        self.assertEqual(len(result), 3)

    def test_six_hour_boundary_uses_first_completion_not_sliding_window(self):
        start = datetime.now(timezone.utc) - timedelta(days=1)
        rows = [announcement(str(i), start + timedelta(hours=h)) for i, h in enumerate([0, 5, 7])]
        result = events.group_events(rows, events.classify(rows, []))
        self.assertEqual(len(result), 2)

    def test_miss_and_ordinary_posts_do_not_become_events(self):
        start = datetime.now(timezone.utc) - timedelta(days=1)
        ordinary = announcement("ordinary", start, matched=False)
        miss = {**announcement("miss", start), "ai_verdict": "miss"}
        rows = [ordinary, miss]
        self.assertTrue(all(m["kind"] == "other" for m in events.classify(rows, []).values()))
        self.assertEqual(events.group_events(rows, events.classify(rows, [])), [])


class EventStorageTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        temp = tempfile.TemporaryDirectory(prefix="crm-events-unit-", dir="/tmp")
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
        self.app.include_router(events_api.router)
        self.app.include_router(tweets_api.router)
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=self.app), base_url="http://test")
        self.addAsyncCleanup(self.client.aclose)

    async def asyncTearDown(self):
        await database.get_engine().dispose()

    async def insert(self, identifier, minutes=1, text="Banked reset available", matched=True):
        row = announcement(identifier, datetime.now(timezone.utc) - timedelta(minutes=minutes), text, matched=matched)
        await tweets.upsert_tweet(row)
        if matched:
            await tweets.mark_hit(identifier, "fixture", [])

    async def test_filters_apply_before_pagination_not_just_to_the_loaded_page(self):
        for i in range(110):
            await self.insert("ordinary-" + str(i), i + 1, "A normal product update", False)
        await self.insert("card-new", 200)
        await self.insert("card-old", 201)
        first = (await self.client.get("/api/tweets?kind=card&limit=1")).json()["data"]
        self.assertEqual([r["id"] for r in first], ["card-new"])
        second = (await self.client.get("/api/tweets?kind=card&limit=1&before=card-new")).json()["data"]
        self.assertEqual([r["id"] for r in second], ["card-old"])
        self.assertEqual(second[0]["kind"], "card")

    async def test_anonymous_window_still_clamps_to_twenty_four_hours(self):
        await self.insert("recent", 1)
        await self.insert("old", 25 * 60)
        recent = (await self.client.get("/api/tweets?hours=720&kind=card")).json()["data"]
        self.assertEqual([r["id"] for r in recent], ["recent"])
        history = (await self.client.get("/api/hits?kind=card")).json()["data"]
        self.assertEqual(len(history), 2)

    async def test_event_cursor_is_stable_and_filters_are_validated(self):
        for i in range(5):
            await self.insert(str(i), i + 1)
        first = (await self.client.get("/api/events?kind=card&limit=2")).json()["data"]
        second = (
            await self.client.get("/api/events", params={"kind": "card", "limit": 2, "before": first["next_cursor"]})
        ).json()["data"]
        self.assertEqual(first["total"], 5)
        self.assertFalse({e["id"] for e in first["items"]} & {e["id"] for e in second["items"]})
        self.assertEqual((await self.client.get("/api/events?before=invalid")).status_code, 400)
        self.assertEqual((await self.client.get("/api/events?kind=invalid")).status_code, 422)
        self.assertEqual((await self.client.get("/api/events?limit=101")).status_code, 422)

    async def test_read_endpoints_never_call_ai(self):
        await self.insert("card")
        with patch("app.services.reset_forecast.ai_upstream.chat", new_callable=AsyncMock) as chat:
            await self.client.get("/api/events")
            await self.client.get("/api/hits?kind=card")
            chat.assert_not_awaited()
