"""测试通知用例：仅调试环境（MONITOR_ENV=debug）开放。"""

from app.core.config import Settings
from app.core.errors import BizError
from app.integrations.notifiers import send_test
from app.schemas import TestNotifyResult


async def test_notify(cfg: Settings) -> list[TestNotifyResult]:
    # 生产环境直接拒绝，防止误触发真实渠道推送
    if not cfg.debug:
        raise BizError(403, "测试通知仅在 MONITOR_ENV=debug 调试环境下可用")
    return [TestNotifyResult.model_validate(r) for r in await send_test(cfg)]
