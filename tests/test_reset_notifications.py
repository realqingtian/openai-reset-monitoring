"""简写重置公告回归：真实临时库 + 模拟飞书响应，不访问真实数据或发送外部消息。

运行：uv run --isolated --group dev python -m unittest discover -s tests -v
"""

import asyncio
import os
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, PropertyMock, patch

from app.core.config import AiConfig, FeishuConfig, MatcherConfig, Settings
from app.core.timeutil import iso_utc
from app.db import database
from app.integrations.notifiers import feishu
from app.repositories import notifies, notify_retry, tweets
from app.services import ai as ai_service
from app.services import classifier, poller, rescan
from app.services.matcher import compile_rules, match_text

ANNOUNCEMENT = (
    "Put the reset in the bag. All propagated.Tibo: Global reset by EOD. May the tokens do good things for you."
)


class ResetRulesTests(unittest.TestCase):
    def test_announcements_without_usage_limits(self):
        rules = compile_rules(MatcherConfig().rules)
        for text in (
            ANNOUNCEMENT,
            "Global reset by EOD. May the tokens do good things for you.",
            "Put the reset in the bag. All propagated.",
            "GLOBAL RESET by EOD.",
            "Usage limits have been reset for all paid ChatGPT Work and Codex users.",
            "A reset is also landing by midnight today.",
        ):
            with self.subTest(text=text):
                self.assertTrue(match_text(text, rules)["matched"])

    def test_ambiguous_reset_mentions_remain_unmatched(self):
        rules = compile_rules(MatcherConfig().rules)
        for text in (
            "Day 6/ Reset",
            "The day we reach perfection it will be resets from there onwardsTibo: Day 6/ Reset",
            "Pro users, would you rather have",
            "A factory reset fixed my phone.",
            "We reset our local development database.",
        ):
            with self.subTest(text=text):
                self.assertFalse(match_text(text, rules)["matched"])


class NotificationFixture(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="codex-reset-notify-", dir="/tmp")
        self.addCleanup(self.temp.cleanup)
        # 配置不读取 .env 或宿主环境，渠道通过 mock 启用，测试中不需要任何凭证。
        with patch.dict(os.environ, {}, clear=True):
            self.cfg = Settings(_env_file=None)
        self.cfg.monitor_ai_forecast = False
        for name, value in (
            ("DB_PATH", Path(self.temp.name) / "smoke.db"),
            ("_engine", None),
            ("_session_factory", None),
        ):
            p = patch.object(database, name, value)
            p.start()
            self.addCleanup(p.stop)
        await database.init_db(self.cfg)
        self.response = Mock()
        self.response.json.return_value = {"code": 0}
        self.client = SimpleNamespace(post=AsyncMock(return_value=self.response))
        self.app = SimpleNamespace(
            state=SimpleNamespace(
                cfg=self.cfg,
                rules=compile_rules(self.cfg.matcher.rules),
                client=self.client,
                poll_lock=asyncio.Lock(),
            )
        )
        for p in (
            patch.object(FeishuConfig, "enabled", new_callable=PropertyMock, return_value=True),
            patch.object(feishu, "is_configured", return_value=True),
            patch("app.services.notify.push_extra", new_callable=AsyncMock, return_value={}),
            patch("app.services.poller.push_extra", new_callable=AsyncMock, return_value={}),
        ):
            p.start()
            self.addCleanup(p.stop)

    async def asyncTearDown(self):
        await database.get_engine().dispose()

    def tweet(self, tweet_id="missed-reset", hours_old=1):
        return {
            "id": tweet_id,
            "account": "thsottiaux",
            "text": ANNOUNCEMENT,
            "url": "https://x.com/thsottiaux/status/" + tweet_id,
            "created_at": iso_utc(datetime.now(timezone.utc) - timedelta(hours=hours_old)),
            "source": "fixture",
        }


class ResetNotificationTests(NotificationFixture):
    async def test_poll_matches_and_sends_feishu_once(self):
        tw = self.tweet()
        with patch.object(poller, "fetch_with_failover", new_callable=AsyncMock) as fetch:
            fetch.return_value = ([tw], {}, "fixture", [])
            await poller.run_poll(self.app)
            await poller.run_poll(self.app)
        stored = await tweets.get_tweet(tw["id"])
        self.assertEqual((stored["matched"], stored["notified"]), (1, 1))
        self.client.post.assert_awaited_once()
        payload = self.client.post.call_args.kwargs["json"]
        self.assertEqual(payload["msg_type"], "text")
        self.assertIn(ANNOUNCEMENT, payload["content"]["text"])
        self.assertEqual(await notify_retry.latest_channel_results(tw["id"]), {"feishu": True})

    async def test_startup_rescan_recovers_missed_announcement_once(self):
        tw = self.tweet()
        await tweets.upsert_tweet(tw)
        self.assertEqual((await tweets.get_tweet(tw["id"]))["matched"], 0)
        await rescan.rescan_once(self.app)
        await rescan.rescan_once(self.app)
        stored = await tweets.get_tweet(tw["id"])
        self.assertEqual((stored["matched"], stored["notified"]), (1, 1))
        self.client.post.assert_awaited_once()

    async def test_rescan_older_announcement_only_patches_history(self):
        tw = self.tweet(hours_old=25)
        await tweets.upsert_tweet(tw)
        await rescan.rescan_once(self.app)
        stored = await tweets.get_tweet(tw["id"])
        self.assertEqual((stored["matched"], stored["notified"]), (1, 0))
        self.client.post.assert_not_awaited()

    async def test_rescan_leaves_attempted_announcement_for_channel_retry(self):
        tw = self.tweet()
        await tweets.upsert_tweet(tw)
        await notifies.log_notify(tw["id"], "feishu", False, "simulated failure")
        await rescan.rescan_once(self.app)
        self.client.post.assert_not_awaited()
        await poller._retry_failed_pushes(self.app)
        self.client.post.assert_awaited_once()
        self.assertEqual((await tweets.get_tweet(tw["id"]))["notified"], 1)

    async def test_feishu_rejection_is_retried_without_resending_success(self):
        tw = self.tweet()
        await tweets.upsert_tweet(tw)
        self.response.json.return_value = {"code": 1, "msg": "simulated failure"}
        await rescan.rescan_once(self.app)
        self.assertEqual((await tweets.get_tweet(tw["id"]))["notified"], 0)
        self.assertEqual(await notify_retry.latest_channel_results(tw["id"]), {"feishu": False})
        self.response.json.return_value = {"code": 0}
        await poller._retry_failed_pushes(self.app)
        await poller._retry_failed_pushes(self.app)
        self.assertEqual(self.client.post.await_count, 2)
        self.assertEqual((await tweets.get_tweet(tw["id"]))["notified"], 1)


SEMANTIC_ANNOUNCEMENT = "All Codex accounts now have their full allowance again. Rollout is complete."


class AiFirstNotificationTests(NotificationFixture):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        p = patch.object(AiConfig, "enabled", new_callable=PropertyMock, return_value=True)
        p.start()
        self.addCleanup(p.stop)
        p = patch.object(ai_service.ai_upstream, "chat", new_callable=AsyncMock)
        self.chat = p.start()
        self.chat.return_value = '{"hit": true, "reason": "已明确宣布额度补满"}'
        self.addCleanup(p.stop)

    async def poll(self, tw):
        with patch.object(poller, "fetch_with_failover", new_callable=AsyncMock) as fetch:
            fetch.return_value = ([tw], {}, "fixture", [])
            await poller.run_poll(self.app)

    async def test_ai_can_notify_without_any_rule_hit(self):
        tw = self.tweet()
        tw["text"] = SEMANTIC_ANNOUNCEMENT
        self.assertFalse(match_text(tw["text"], self.app.state.rules)["matched"])
        with patch.object(classifier, "match_text") as fallback:
            await self.poll(tw)
            await self.poll(tw)
            await rescan.rescan_once(self.app)
            fallback.assert_not_called()
        stored = await tweets.get_tweet(tw["id"])
        self.assertEqual((stored["matched"], stored["notified"], stored["ai_verdict"]), (1, 1, "hit"))
        self.assertEqual(stored["rule_name"], classifier.AI_RULE_NAME)
        self.chat.assert_awaited_once()
        self.client.post.assert_awaited_once()

    async def test_ai_miss_overrides_regex_and_is_cached(self):
        tw = self.tweet()
        self.chat.return_value = '{"hit": false, "reason": "只是旧闻讨论"}'
        self.assertTrue(match_text(tw["text"], self.app.state.rules)["matched"])
        with patch.object(classifier, "match_text") as fallback:
            await self.poll(tw)
            await rescan.rescan_once(self.app)
            await rescan.rescan_once(self.app)
            fallback.assert_not_called()
        stored = await tweets.get_tweet(tw["id"])
        self.assertEqual((stored["matched"], stored["notified"], stored["ai_verdict"]), (0, 0, "miss"))
        self.chat.assert_awaited_once()
        self.client.post.assert_not_awaited()

    async def test_ai_timeout_uses_rules_without_caching_false_miss(self):
        self.chat.side_effect = TimeoutError("simulated timeout")
        hit = self.tweet("fallback-hit")
        miss = self.tweet("fallback-miss")
        miss["text"] = SEMANTIC_ANNOUNCEMENT
        await self.poll(hit)
        await self.poll(miss)
        for tw, matched, notified in ((hit, 1, 1), (miss, 0, 0)):
            stored = await tweets.get_tweet(tw["id"])
            self.assertEqual((stored["matched"], stored["notified"], stored["ai_verdict"]), (matched, notified, None))
        self.client.post.assert_awaited_once()

    async def test_disabled_ai_uses_rules_without_call(self):
        self.cfg.monitor_ai_review = False
        await self.poll(self.tweet())
        self.chat.assert_not_awaited()
        self.client.post.assert_awaited_once()

    async def test_unconfigured_ai_uses_rules_without_call(self):
        with patch.object(AiConfig, "enabled", new_callable=PropertyMock, return_value=False):
            await self.poll(self.tweet())
        self.chat.assert_not_awaited()
        self.client.post.assert_awaited_once()

    async def test_rescan_recovers_unmatched_post_via_ai_once(self):
        tw = self.tweet()
        tw["text"] = SEMANTIC_ANNOUNCEMENT
        await tweets.upsert_tweet(tw)
        await rescan.rescan_once(self.app)
        await rescan.rescan_once(self.app)
        stored = await tweets.get_tweet(tw["id"])
        self.assertEqual((stored["matched"], stored["notified"], stored["ai_verdict"]), (1, 1, "hit"))
        self.chat.assert_awaited_once()
        self.client.post.assert_awaited_once()

    async def test_rescan_old_post_uses_ai_but_does_not_push(self):
        tw = self.tweet(hours_old=25)
        tw["text"] = SEMANTIC_ANNOUNCEMENT
        await tweets.upsert_tweet(tw)
        await rescan.rescan_once(self.app)
        await rescan.rescan_once(self.app)
        stored = await tweets.get_tweet(tw["id"])
        self.assertEqual((stored["matched"], stored["notified"], stored["ai_verdict"]), (1, 0, "hit"))
        self.chat.assert_awaited_once()
        self.client.post.assert_not_awaited()

    async def test_rescan_rejects_legacy_regex_candidate(self):
        tw = self.tweet()
        await tweets.upsert_tweet(tw)
        await tweets.mark_hit(tw["id"], "legacy rule", ["reset"])
        self.chat.return_value = '{"hit": false, "reason": "历史讨论"}'
        await rescan.rescan_once(self.app)
        stored = await tweets.get_tweet(tw["id"])
        self.assertEqual((stored["matched"], stored["notified"], stored["ai_verdict"]), (0, 0, "miss"))
        self.client.post.assert_not_awaited()

    async def test_cached_miss_never_reaches_rescan_or_retry_push(self):
        tw = self.tweet()
        await tweets.upsert_tweet(tw)
        await tweets.mark_hit(tw["id"], "legacy rule", ["reset"])
        await tweets.save_ai_review(tw["id"], "miss", "此前已判定无关")
        await notifies.log_notify(tw["id"], "feishu", False, "simulated failure")
        await poller._retry_failed_pushes(self.app)
        await rescan.rescan_once(self.app)
        self.chat.assert_not_awaited()
        self.client.post.assert_not_awaited()
        self.assertEqual((await tweets.get_tweet(tw["id"]))["notified"], 0)

    async def test_failed_channel_retries_without_reclassifying(self):
        tw = self.tweet()
        tw["text"] = SEMANTIC_ANNOUNCEMENT
        self.response.json.return_value = {"code": 1, "msg": "simulated failure"}
        await self.poll(tw)
        self.response.json.return_value = {"code": 0}
        await self.poll(tw)
        await self.poll(tw)
        self.chat.assert_awaited_once()
        self.assertEqual(self.client.post.await_count, 2)
        self.assertEqual((await tweets.get_tweet(tw["id"]))["notified"], 1)

    async def test_cached_hit_is_used_after_restart_without_ai_call(self):
        tw = self.tweet()
        tw["text"] = SEMANTIC_ANNOUNCEMENT
        await tweets.upsert_tweet(tw)
        await tweets.save_ai_review(tw["id"], "hit", "此前已确认公告")
        await rescan.rescan_once(self.app)
        self.chat.assert_not_awaited()
        self.client.post.assert_awaited_once()


class AiResponseTests(unittest.IsolatedAsyncioTestCase):
    async def test_invalid_responses_are_fail_open(self):
        with patch.dict(os.environ, {}, clear=True):
            cfg = Settings(_env_file=None)
        with (
            patch.object(AiConfig, "enabled", new_callable=PropertyMock, return_value=True),
            patch.object(ai_service.ai_upstream, "chat", new_callable=AsyncMock) as chat,
        ):
            for raw in (
                "not json",
                "{}",
                '{"hit": "false", "reason": "invalid type"}',
                '{"hit": null, "reason": "invalid type"}',
                '{"hit": 0, "reason": "invalid type"}',
                '{"hit": true}',
                '{"hit": false, "reason": null}',
                '{"hit": false, "reason": ""}',
                '{"hit": false, "reason": "   "}',
            ):
                with self.subTest(raw=raw):
                    chat.return_value = raw
                    self.assertIsNone(await ai_service.classify_text(cfg, None, ANNOUNCEMENT, "thsottiaux"))

    async def test_valid_fenced_response_and_prompt_do_not_require_rules(self):
        with patch.dict(os.environ, {}, clear=True):
            cfg = Settings(_env_file=None)
        with (
            patch.object(AiConfig, "enabled", new_callable=PropertyMock, return_value=True),
            patch.object(ai_service.ai_upstream, "chat", new_callable=AsyncMock) as chat,
        ):
            chat.return_value = '```json\n{"hit": true, "reason": "明确补满额度"}\n```'
            result = await ai_service.classify_text(cfg, None, SEMANTIC_ANNOUNCEMENT, "thsottiaux")
            self.assertEqual(result, {"verdict": "hit", "reason": "明确补满额度"})
            user = chat.call_args.args[3]
            self.assertIn(SEMANTIC_ANNOUNCEMENT, user)
            self.assertNotIn("命中规则", user)


if __name__ == "__main__":
    unittest.main()
