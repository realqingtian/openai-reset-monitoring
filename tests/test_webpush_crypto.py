"""可选额外依赖的真实加解密回归；不发起网络连接或系统通知权限请求。"""

import base64
import importlib.util
import os
import unittest
from unittest.mock import patch

from app.core.config import Settings
from app.integrations.public_notifications import _push


@unittest.skipUnless(importlib.util.find_spec("pywebpush"), "optional webpush extra not installed")
class WebPushCrypto(unittest.TestCase):
    def test_real_encryption_roundtrip_and_adapter_signature(self):
        import http_ece
        from cryptography.hazmat.primitives import serialization
        from cryptography.hazmat.primitives.asymmetric import ec
        from pywebpush import WebPusher

        private = ec.generate_private_key(ec.SECP256R1())
        public = private.public_key().public_bytes(
            serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
        )
        auth = os.urandom(16)

        def encode(value):
            return base64.urlsafe_b64encode(value).decode().rstrip("=")

        subscription = {
            "endpoint": "https://fcm.googleapis.com/send/fixture",
            "keys": {"p256dh": encode(public), "auth": encode(auth)},
        }
        plaintext = b'{"title":"fixture announcement"}'
        encrypted = WebPusher(subscription).encode(plaintext)["body"]
        self.assertNotEqual(encrypted, plaintext)
        self.assertEqual(
            http_ece.decrypt(encrypted, private_key=private, auth_secret=auth, version="aes128gcm"), plaintext
        )
        with patch.dict(os.environ, {}, clear=True):
            cfg = Settings(_env_file=None)
        with patch("pywebpush.webpush", autospec=True) as sender:
            self.assertEqual(_push(cfg, subscription, {"title": "fixture"}), (True, False, None))
            self.assertEqual(sender.call_args.kwargs["subscription_info"], subscription)
            self.assertEqual(sender.call_args.kwargs["timeout"], 12)
