"""ORM 模型：一表一模块；既有五张表与旧库一致，app_state 为新增表（create_all 自动补建）。

统一从这里 re-export：业务侧始终 `from app.models import Xxx`，
不感知具体文件；Base 一并暴露供 init_db 注册元数据。

类型约定（Mapped 显式标注）：主键非可选；其余列全部 Optional，与旧库
nullable=True 语义一致，业务写入方自行保证必填列有值。唯一差异：已有库
不受影响（create_all 见表即跳），新建库的主键列会显式 NOT NULL（旧库建表
时未显式声明，但主键语义本就非空，新 schema 更严格且兼容）。
"""

from app.db.database import Base
from app.models.app_state import AppState
from app.models.notify_log import NotifyLog
from app.models.poll import Poll
from app.models.source_health import SourceHealth
from app.models.translation import Translation
from app.models.tweet import Tweet

__all__ = ["AppState", "Base", "NotifyLog", "Poll", "SourceHealth", "Translation", "Tweet"]
