"""预测回归：临时库与模拟 AI；不发外部通知，不依赖真实凭证。"""
import json
import os
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import AsyncMock, PropertyMock, patch

from app.core.config import AiConfig, Settings
from app.core.timeutil import iso_utc
from app.db import database
from app.repositories import tweets, app_state
from app.services import reset_forecast as forecast, stats, calendar

NOW = datetime(2026, 10, 11, 12, tzinfo=timezone.utc)


def row(n, at=None, text='Usage limits have been reset for all Codex users.'):
    return {'id': str(n), 'account': 'thsottiaux', 'text': text, 'url': 'https://x.com/thsottiaux/status/' + str(n), 'created_at': iso_utc(at or NOW - timedelta(hours=n * 24)), 'source': 'fixture', 'matched': 1}


def event(n, kind='quota', phase='completed', **extra):
    return {'id': str(n), 'kind': kind, 'phase': phase, 'explicit': False, 'start': None, 'end': None, 'reason': '明确公告', **extra}


class ForecastLogicTests(unittest.TestCase):
    def test_pending_day_preview_remains_visible_without_inventing_a_window(self):
        source = row(1, NOW, 'Day 21/ But today is a reset.')
        out = forecast.calculate([source], [event(1, phase='scheduled')], NOW, ai_used=True)
        self.assertEqual(out.pending_preview.id, source['id'])
        self.assertEqual(out.pending_preview.account, source['account'])
        self.assertEqual(out.pending_preview.text, source['text'])
        self.assertEqual(out.pending_preview.timing, 'same_day')
        self.assertEqual(out.reason_code, 'timezone_unknown')
        self.assertIsNone(out.window_start)
        self.assertIsNone(out.window_end)
        self.assertIsNone(out.expected_at)

    def test_latest_untimed_preview_supersedes_an_older_exact_window(self):
        rows = [row(1, NOW - timedelta(hours=2), 'Reset at 18:00 UTC'), row(2, NOW, 'A reset is coming soon')]
        old = event(1, phase='scheduled', explicit=True, start=iso_utc(NOW + timedelta(hours=6)), end=iso_utc(NOW + timedelta(hours=7)))
        out = forecast.calculate(rows, [old, event(2, phase='scheduled')], NOW)
        self.assertEqual(out.pending_preview.id, '2')
        self.assertEqual(out.pending_preview.timing, 'unspecified')
        self.assertIsNone(out.window_start)

    def test_completion_retires_preview_and_banked_grants_are_not_next_quota_resets(self):
        rows = [row(1, NOW - timedelta(hours=2), 'Today is a reset.'), row(2, NOW), row(3, NOW, 'Banked reset arriving tomorrow')]
        out = forecast.calculate(rows, [event(1, phase='scheduled'), event(2), event(3, 'card', 'scheduled')], NOW)
        self.assertIsNone(out.pending_preview)
        self.assertEqual(out.last_reset_at, iso_utc(NOW))

    def test_fallback_preserves_day_pledge_when_ai_is_unavailable(self):
        rows = [row(1, NOW, 'Today is a reset.')]
        events = forecast.fallback_events(rows)
        self.assertEqual(events[0]['phase'], 'scheduled')
        out = forecast.calculate(rows, events, NOW)
        self.assertEqual(out.pending_preview.timing, 'same_day')
        self.assertEqual(out.sample_events, 0)

    def test_future_dated_source_does_not_become_current_preview(self):
        rows = [row(1, NOW + timedelta(days=1), 'Today is a reset.')]
        out = forecast.calculate(rows, [event(1, phase='scheduled')], NOW)
        self.assertIsNone(out.pending_preview)

    def test_reset_day_pledge_does_not_advance_completion_clock_from_cached_ai(self):
        rows = [row(1, NOW, 'Day 21/ But today is a reset.')]
        out = forecast.calculate(rows, [event(1)], NOW, ai_used=True)
        self.assertEqual(out.sample_events, 0)
        self.assertIsNone(out.last_reset_at)
        self.assertEqual(out.reason_code, 'timezone_unknown')

    def test_new_ai_analysis_normalizes_reset_day_pledge_without_mutating_source(self):
        rows = [row(1, NOW, 'It is reset day today. Tibo: Usage limits have been reset.')]
        raw = json.dumps({'events': [event(1)]})
        result = forecast.validate_analysis(raw, rows)
        self.assertEqual(result[0]['phase'], 'scheduled')
        self.assertIn('尚未明确确认完成', result[0]['reason'])
        self.assertIn('have been reset', rows[0]['text'])

    def test_five_stable_events_produce_window_instead_of_exact_guarantee(self):
        rows = [row(n) for n in range(5)]
        out = forecast.calculate(rows, [event(n) for n in range(5)], NOW, ai_used=True)
        self.assertEqual((out.status, out.sample_events, out.confidence), ('estimated', 5, 'low'))
        self.assertEqual(out.median_interval_hours, 24)
        self.assertEqual(out.window_start, iso_utc(NOW + timedelta(hours=18)))
        self.assertEqual(out.window_end, iso_utc(NOW + timedelta(hours=30)))

    def test_cards_previews_and_other_announcements_do_not_inflate_samples(self):
        rows = [row(n) for n in range(8)]
        events = [event(n) for n in range(4)] + [event(4, 'card'), event(5, phase='scheduled'), event(6, 'other'), event(7, phase='unknown')]
        out = forecast.calculate(rows, events, NOW)
        self.assertEqual((out.status, out.sample_events), ('unavailable', 4))
        self.assertIsNone(out.expected_at)

    def test_confirmation_posts_within_six_hours_are_one_event(self):
        rows = [row(1, NOW - timedelta(hours=3)), row(2, NOW - timedelta(hours=1)), row(3, NOW)]
        out = forecast.calculate(rows, [event(n) for n in (1, 2, 3)], NOW)
        self.assertEqual(out.sample_events, 1)
        self.assertIsNone(out.expected_at)

    def test_irregular_manual_resets_abstain_even_with_many_samples(self):
        hours = [0, 8, 60, 84, 180, 210]
        out = forecast.calculate([row(n, NOW - timedelta(hours=h)) for n, h in enumerate(hours)], [event(n) for n in range(6)], NOW)
        self.assertEqual((out.status, out.reason_code), ('unavailable', 'irregular'))

    def test_expired_window_never_rolls_forward(self):
        out = forecast.calculate([row(n) for n in range(5)], [event(n) for n in range(5)], NOW + timedelta(days=4))
        self.assertEqual((out.status, out.reason_code), ('expired', 'elapsed'))
        self.assertIsNone(out.expected_at)
        self.assertLess(forecast.parse_time(out.window_end), NOW + timedelta(days=4))

    def test_explicit_future_announcement_works_without_five_samples(self):
        rows = [row(1, NOW - timedelta(hours=1), 'Global reset at 18:00 UTC today')]
        ev = event(1, phase='scheduled', explicit=True, start=iso_utc(NOW + timedelta(hours=6)), end=iso_utc(NOW + timedelta(hours=7)))
        out = forecast.calculate(rows, [ev], NOW, ai_used=True)
        self.assertEqual((out.status, out.method), ('announced', 'ai_announcement'))
        self.assertEqual(out.evidence_ids, ['1'])

    def test_completed_announcement_cancels_older_preview(self):
        rows = [row(1, NOW - timedelta(hours=5)), row(2, NOW)]
        ev = event(1, phase='scheduled', explicit=True, start=iso_utc(NOW + timedelta(hours=1)), end=iso_utc(NOW + timedelta(hours=4)))
        out = forecast.calculate(rows, [ev, event(2)], NOW)
        self.assertIsNone(out.expected_at)
        self.assertEqual(out.sample_events, 1)

    def test_old_card_preview_does_not_claim_timezone_is_missing(self):
        rows = [row(1, NOW - timedelta(hours=5)), row(2, NOW)]
        out = forecast.calculate(rows, [event(1, 'card', 'scheduled'), event(2)], NOW)
        self.assertEqual(out.reason_code, 'insufficient')

    def test_new_untimed_preview_blocks_historical_extrapolation(self):
        rows = [row(n, NOW - timedelta(hours=n * 24 + 1)) for n in range(5)] + [row(99, NOW, 'Global reset by EOD')]
        out = forecast.calculate(rows, [event(n) for n in range(5)] + [event(99, phase='scheduled')], NOW)
        self.assertEqual((out.status, out.reason_code), ('unavailable', 'timezone_unknown'))
        self.assertIsNone(out.expected_at)

    def test_multiple_accounts_are_not_combined(self):
        rows = [row(1), row(2)]
        rows[1]['account'] = 'different-account'
        self.assertEqual(forecast.calculate(rows, [event(1), event(2)], NOW).reason_code, 'multiple_accounts')

    def test_naive_and_invalid_dates_do_not_become_now(self):
        self.assertIsNone(forecast.parse_time('not a time'))
        self.assertIsNone(forecast.parse_time('2026-10-11T12:00:00'))

    def test_quoted_history_is_not_a_completed_new_event(self):
        r = row(1, text='Maybe another one soon. Tibo: Usage limits have been reset for all users.')
        self.assertEqual(forecast.fallback_events([r]), [])

    def test_invalid_ai_ids_types_coverage_and_timezones_are_rejected(self):
        rows = [row(1, NOW, 'Global reset by EOD')]
        invalid = [[], [event(2)], [event(1), event(1)], [event(1, explicit='true')], [event(1, phase='scheduled', explicit=True, start=iso_utc(NOW), end=iso_utc(NOW + timedelta(hours=6)))]]
        for events in invalid:
            with self.subTest(events=events), self.assertRaises(ValueError):
                forecast.validate_analysis(json.dumps({'events': events}), rows)

    def test_valid_explicit_time_is_bounded_to_actual_evidence(self):
        rows = [row(1, NOW, 'Global reset today at 18:00 UTC')]
        ev = event(1, phase='scheduled', explicit=True, start=iso_utc(NOW + timedelta(hours=6)), end=iso_utc(NOW + timedelta(hours=7)))
        self.assertEqual(forecast.validate_analysis(json.dumps({'events':[ev]}), rows)[0]['id'], '1')


class ForecastStorageTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='codex-forecast-tests-', dir='/tmp')
        self.addCleanup(self.temp.cleanup)
        with patch.dict(os.environ, {}, clear=True):
            self.cfg = Settings(_env_file=None)
        for name, value in [('DB_PATH', Path(self.temp.name) / 'tests.db'), ('_engine', None), ('_session_factory', None)]:
            p=patch.object(database,name,value);p.start();self.addCleanup(p.stop)
        await database.init_db(self.cfg)
        self.enabled = patch.object(AiConfig,'enabled',new_callable=PropertyMock,return_value=True)
        self.enabled.start();self.addCleanup(self.enabled.stop)
        self.chat_patch = patch.object(forecast.ai_upstream,'chat',new_callable=AsyncMock)
        self.chat = self.chat_patch.start();self.addCleanup(self.chat_patch.stop)
        self.rows=[row(n, datetime.now(timezone.utc) - timedelta(hours=n * 24)) for n in range(5)]
        for r in self.rows:
            await tweets.upsert_tweet(r)
            await tweets.mark_hit(r['id'], 'fixture', [])
        self.chat.return_value=json.dumps({'events':[event(n) for n in range(5)]})

    async def asyncTearDown(self):
        await database.get_engine().dispose()

    async def test_refresh_is_persisted_and_public_reads_do_not_call_ai(self):
        await forecast.refresh(self.cfg, None)
        await forecast.refresh(self.cfg, None)
        data=await stats.assemble_stats(self.cfg)
        cal=await calendar.assemble_calendar(2026,10,self.cfg)
        self.assertEqual(data.forecast.status,'estimated')
        self.assertEqual(data.forecast.window_end,cal.forecast.window_end)
        self.assertTrue(all(e.phase == 'completed' for e in cal.events))
        self.chat.assert_awaited_once()
        self.assertIn(forecast.CACHE_KEY, await app_state.get_all())
        self.assertIn('0', [e.id for e in data.forecast.evidence])
        self.assertTrue(all(e.analysis for e in data.forecast.evidence))

    async def test_failure_uses_fallback_and_has_retry_cooldown(self):
        self.chat.side_effect=TimeoutError('fixture')
        await forecast.refresh(self.cfg,None)
        await forecast.refresh(self.cfg,None)
        out=await forecast.snapshot(self.cfg,datetime.now(timezone.utc))
        self.assertEqual((out.method,out.confidence),('history','low'))
        self.chat.assert_awaited_once()

    async def test_new_post_invalidates_cached_forecast_before_analysis(self):
        await forecast.refresh(self.cfg,None)
        r=row(99,datetime.now(timezone.utc),'Global reset by EOD')
        await tweets.upsert_tweet(r)
        self.assertEqual((await forecast.snapshot(self.cfg,datetime.now(timezone.utc))).method,'history')
        self.chat.return_value=json.dumps({'events':[event(n) for n in range(5)]+[event(99,phase='scheduled')]})
        await forecast.refresh(self.cfg,None)
        self.assertEqual(self.chat.await_count,2)

    async def test_demo_never_uses_real_ai_even_when_configured(self):
        self.cfg.demo=True
        await forecast.refresh(self.cfg,None)
        self.chat.assert_not_awaited()
