"""SQLite 异步存储基础设施：引擎 / 会话工厂 / 建表与防御迁移。

SQLAlchemy 2.x async + aiosqlite 驱动。
表名、列名与旧库完全一致，create_all 对已有库必须是无操作。
"""

from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, cast

from sqlalchemy import event, text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.core.config import Settings
from app.core.text import content_hash
from app.core.timeutil import hours_ago_iso, iso_utc

# 模块位于 app/db/ 下，三级 parent 回到仓库根
ROOT = Path(__file__).resolve().parent.parent.parent
# 库文件路径；测试时可改指 /tmp 拷贝（支持 str 或 Path，引擎惰性创建，改后生效）
DB_PATH = ROOT / "data" / "monitor.db"


class Base(DeclarativeBase):
    """ORM 基类：app/models/ 下各表模型继承此类，导入即注册元数据。"""


_engine: Optional[AsyncEngine] = None
_session_factory: Optional[async_sessionmaker[AsyncSession]] = None


def get_engine() -> AsyncEngine:
    """惰性创建异步引擎（首次调用时读取当前 DB_PATH，支持 str 或 Path）。"""
    global _engine, _session_factory
    engine = _engine
    if engine is None:
        db_file = Path(DB_PATH)
        db_file.parent.mkdir(parents=True, exist_ok=True)
        engine = create_async_engine("sqlite+aiosqlite:///" + str(db_file))

        # 每条连接建立时设置 WAL 与忙等待超时，降低读写互锁概率
        @event.listens_for(engine.sync_engine, "connect")
        def _set_sqlite_pragma(dbapi_conn, _record):
            cur = dbapi_conn.cursor()
            cur.execute("PRAGMA journal_mode=WAL")
            cur.execute("PRAGMA busy_timeout=5000")
            cur.close()

        _engine = engine
        _session_factory = async_sessionmaker(engine, expire_on_commit=False)
    return engine


def session_factory() -> AsyncSession:
    """取一个新会话：repository 内用法 `async with session_factory() as s:`。"""
    get_engine()
    # get_engine() 已保证工厂完成初始化；cast 消除 IDE 对惰性全局变量的 None 误报
    factory = cast(async_sessionmaker[AsyncSession], _session_factory)
    return factory()


async def init_db(cfg: Optional[Settings] = None):
    """建表 + 旧库防御迁移 + 日志清理。幂等：对已迁移的库重复执行无改动。

    cfg 提供保留期配置；缺省时用与旧版一致的 30 天（兼容未传 cfg 的调用方）。
    """
    engine = get_engine()
    async with engine.begin() as conn:
        # 局部导入：models 依赖本模块的 Base，避免循环导入
        from app import models

        # run_sync 要求首参为 Connection 的回调，包一层适配 create_all 的签名（行为不变）
        await conn.run_sync(lambda sync_conn: models.Base.metadata.create_all(sync_conn))

    async with session_factory() as s:
        # 旧库迁移①：补齐 content_hash 列与指纹索引（create_all 不会给已存在的表补索引）
        cols = [r.name for r in (await s.execute(text("PRAGMA table_info(tweets)"))).fetchall()]
        if "content_hash" not in cols:
            await s.execute(text("ALTER TABLE tweets ADD COLUMN content_hash TEXT"))
        await s.execute(text("CREATE INDEX IF NOT EXISTS idx_tweets_hash ON tweets(content_hash)"))
        # 旧库迁移②：为已推送过的历史推文回填内容指纹，使"同内容不同推文"也能被去重
        rows = (
            await s.execute(
                text(
                    "SELECT id, text FROM tweets WHERE notified=1 AND (content_hash IS NULL OR content_hash='')",
                )
            )
        ).fetchall()
        for r in rows:
            await s.execute(
                text("UPDATE tweets SET content_hash=:h WHERE id=:tid"), {"h": content_hash(r.text), "tid": r.id}
            )
        # 旧库迁移③：兼容曾按北京时间(+08:00)存储的旧库：迁回真实 UTC；只处理 +08:00 结尾的行，保证只执行一次
        rows = (
            await s.execute(text("SELECT id, created_at FROM tweets WHERE created_at LIKE :pat"), {"pat": "%+08:00"})
        ).fetchall()
        for r in rows:
            dt = datetime.fromisoformat(r.created_at).astimezone(timezone.utc)
            await s.execute(
                text("UPDATE tweets SET created_at=:created WHERE id=:tid"), {"created": iso_utc(dt), "tid": r.id}
            )
        # 旧库迁移④：回复标记列（twitterapi.io 可判定；RSS 源无法判定存 NULL，面板仅对 1 显示徽章）
        if "is_reply" not in cols:
            await s.execute(text("ALTER TABLE tweets ADD COLUMN is_reply INTEGER"))
        # 日志表只保留 30 天，防止长期运行无限膨胀
        cutoff = hours_ago_iso(24 * 30)
        await s.execute(text("DELETE FROM polls WHERE ts < :cutoff"), {"cutoff": cutoff})
        await s.execute(text("DELETE FROM notify_log WHERE ts < :cutoff"), {"cutoff": cutoff})
        # 推文保留分级：未命中随窗口滚动清理（与回扫窗口一致），命中延长保留供节奏统计采样；
        # matched 可能为 NULL，须 COALESCE 后比较，否则 NULL 行不会落在任何一条清理规则里
        tweet_days = cfg.tweet_retention_days if cfg else 30
        hit_days = cfg.hit_retention_days if cfg else 180
        await s.execute(
            text("DELETE FROM tweets WHERE COALESCE(matched, 0) != 1 AND created_at < :cutoff"),
            {"cutoff": hours_ago_iso(24 * tweet_days)},
        )
        await s.execute(text("DELETE FROM tweets WHERE created_at < :cutoff"), {"cutoff": hours_ago_iso(24 * hit_days)})
        await s.commit()
