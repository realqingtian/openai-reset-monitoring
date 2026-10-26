"""导出只读契约与标准格式安全边界。"""

import unittest
from unittest.mock import AsyncMock, patch
from xml.etree.ElementTree import fromstring

import httpx
from app.api import exports as exports_api
from app.core.config import Settings
from app.schemas.event import ResetEventOut
from app.schemas.tweet import TweetOut
from app.services import exports
from fastapi import FastAPI


def event(identifier="one", phase="completed", start=None, end=None):
    return ResetEventOut(
        id=identifier,
        account="fixture",
        kind="quota",
        phase=phase,
        announced_at="2030-01-01T00:00:00Z",
        updated_at="2030-01-01T00:00:00Z",
        completed_at="2030-01-01T00:00:00Z" if phase == "completed" else None,
        window_start=start,
        window_end=end,
        evidence=[
            TweetOut(
                id="source",
                source="fixture",
                matched=1,
                notified=0,
                account="fixture",
                created_at="2030-01-01T00:00:00Z",
                text="<script>&\x00" + "公告" * 60,
                url="https://example.org/?a=1&b=2",
            )
        ],
    )


class ExportTests(unittest.TestCase):
    def test_calendar_excludes_unknown_or_timezone_less_previews(self):
        body = exports.calendar(
            [
                event(),
                event("unknown", "unknown"),
                event("naive", "scheduled", "2030-01-01T12:00:00"),
                event("window", "scheduled", "2030-01-01T12:00:00+08:00", "2030-01-01T13:00:00+08:00"),
            ],
            "zh",
        )
        self.assertEqual(body.count("BEGIN:VEVENT"), 2)
        self.assertIn("DTSTART:20300101T040000Z", body)
        self.assertIn("DTEND:20300101T050000Z", body)
        self.assertTrue(all(len(line.encode()) <= 75 for line in body.split("\r\n")))

    def test_calendar_escapes_crlf_and_delimiters(self):
        self.assertEqual(exports.escape_calendar("a\r\nBEGIN:VALARM;b,c\\d"), "a\\nBEGIN:VALARM\\;b\\,c\\\\d")
        body = exports.fold("公告" * 40)
        self.assertEqual(body.replace("\r\n ", ""), "公告" * 40)

    def test_atom_and_rss_are_valid_xml_with_stable_ids_and_escaped_content(self):
        for kind in ["atom", "rss"]:
            body = exports.feed([event()], "https://example.org", kind, "en")
            root = fromstring(body)
            self.assertIn(b"urn:codex-reset-monitor:event:one", body)
            if kind == "atom":
                self.assertIn(b"&lt;script&gt;&amp;", body)
            else:
                self.assertNotIn("<script>", root.find("channel/item/description").text)
            self.assertNotIn(b"\x00", body)
            self.assertIsNotNone(root)

    def test_bad_url_is_not_exported(self):
        row = event()
        row.evidence[0].url = "javascript:alert(1)"
        self.assertEqual(exports.safe_link(row), "")


class ExportRoutes(unittest.IsolatedAsyncioTestCase):
    async def test_limits_content_types_filters_and_no_ai_reads(self):
        app = FastAPI()
        app.state.cfg = Settings(_env_file=None)
        app.include_router(exports_api.router)
        with (
            patch("app.api.exports.events.all_events", AsyncMock(return_value=[event()])) as read,
            patch("app.services.reset_forecast.ai_upstream.chat", AsyncMock()) as ai,
        ):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="https://test") as client:
                for path, media in [
                    ("/calendar.ics", "text/calendar"),
                    ("/feed.atom", "application/atom+xml"),
                    ("/feed.rss", "application/rss+xml"),
                ]:
                    response = await client.get(path)
                    self.assertEqual(response.status_code, 200)
                    self.assertIn(media, response.headers["content-type"])
                    self.assertEqual((await client.get(path + "?limit=0")).status_code, 422)
                self.assertNotIn("BEGIN:VEVENT", (await client.get("/calendar.ics?kind=card")).text)
                ai.assert_not_awaited()
                self.assertEqual(read.await_count, 4)
