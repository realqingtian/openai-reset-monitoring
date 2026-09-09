"""SQLite 存储：推文、检查日志、数据源健康、通知日志。全部查询使用静态 SQL + 参数绑定。"""
import json
import sqlite3
from contextlib import contextmanager
from pathlib import Path

from app.util import content_hash, hours_ago_iso, iso_utc

ROOT = Path(__file__).resolve().parent.parent
DB_PATH = ROOT / "data" / "monitor.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS tweets(
  id TEXT PRIMARY KEY, account TEXT, text TEXT, url TEXT,
  created_at TEXT, fetched_at TEXT, source TEXT,
  matched INTEGER DEFAULT 0, rule_name TEXT, matched_terms TEXT,
  notified INTEGER DEFAULT 0, content_hash TEXT
);
CREATE INDEX IF NOT EXISTS idx_tweets_created ON tweets(created_at);
CREATE TABLE IF NOT EXISTS polls(
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, account TEXT,
  source TEXT, ok INTEGER, new_tweets INTEGER, error TEXT, latency_ms INTEGER
);
CREATE TABLE IF NOT EXISTS source_health(
  source TEXT PRIMARY KEY, healthy INTEGER, failures INTEGER DEFAULT 0,
  last_ok TEXT, last_error TEXT, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS notify_log(
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, tweet_id TEXT,
  channel TEXT, ok INTEGER, error TEXT
);
"""


@contextmanager
def _db():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db():
    with _db() as c:
        c.executescript(SCHEMA)
        # 旧库迁移：补充 content_hash 列与索引
        cols = [r["name"] for r in c.execute("PRAGMA table_info(tweets)").fetchall()]
        if "content_hash" not in cols:
            c.execute("ALTER TABLE tweets ADD COLUMN content_hash TEXT")
        c.execute("CREATE INDEX IF NOT EXISTS idx_tweets_hash ON tweets(content_hash)")
        # 为已推送过的历史推文回填内容指纹，使"同内容不同推文"也能被去重
        rows = c.execute(
            "SELECT id, text FROM tweets WHERE notified=1 AND (content_hash IS NULL OR content_hash='')"
        ).fetchall()
        for r in rows:
            c.execute("UPDATE tweets SET content_hash=? WHERE id=?",
                      (content_hash(r["text"]), r["id"]))
        # 日志表只保留 30 天，防止长期运行无限膨胀
        cutoff = hours_ago_iso(24 * 30)
        c.execute("DELETE FROM polls WHERE ts < ?", (cutoff,))
        c.execute("DELETE FROM notify_log WHERE ts < ?", (cutoff,))


def upsert_tweet(t):
    with _db() as c:
        cur = c.execute(
            "INSERT OR IGNORE INTO tweets(id,account,text,url,created_at,fetched_at,source,content_hash) VALUES(?,?,?,?,?,?,?,?)",
            (t["id"], t["account"], t["text"], t["url"], t["created_at"], iso_utc(), t["source"],
             content_hash(t["text"])),
        )
        return cur.rowcount > 0


def hash_already_notified(chash, exclude_id):
    """同内容指纹的推文是否已推送过（用于跨推文的内容去重）。"""
    with _db() as c:
        row = c.execute(
            "SELECT 1 FROM tweets WHERE content_hash=? AND notified=1 AND id<>? LIMIT 1",
            (chash, exclude_id),
        ).fetchone()
        return row is not None


def notified_texts_since(iso):
    """取时间窗口内已推送的推文文本，供相似度去重比对。"""
    with _db() as c:
        rows = c.execute(
            "SELECT id, text FROM tweets WHERE notified=1 AND created_at>=?",
            (iso,),
        ).fetchall()
        return [(r["id"], r["text"]) for r in rows]


def mark_hit(tweet_id, rule_name, terms):
    with _db() as c:
        c.execute("UPDATE tweets SET matched=1, rule_name=?, matched_terms=? WHERE id=?",
                  (rule_name, json.dumps(terms, ensure_ascii=False), tweet_id))


def mark_notified(tweet_id):
    with _db() as c:
        c.execute("UPDATE tweets SET notified=1 WHERE id=?", (tweet_id,))


def account_has_tweets(account):
    with _db() as c:
        row = c.execute("SELECT 1 FROM tweets WHERE account=? LIMIT 1", (account,)).fetchone()
        return row is not None


def tweets_since(iso):
    with _db() as c:
        rows = c.execute("SELECT * FROM tweets WHERE created_at>=? ORDER BY created_at DESC", (iso,)).fetchall()
        return [dict(r) for r in rows]


def matched_tweets(limit=100):
    with _db() as c:
        rows = c.execute("SELECT * FROM tweets WHERE matched=1 ORDER BY created_at DESC LIMIT ?", (limit,)).fetchall()
        return [dict(r) for r in rows]


def log_poll(account, source, ok, new_tweets=0, error=None, latency_ms=None):
    with _db() as c:
        c.execute("INSERT INTO polls(ts,account,source,ok,new_tweets,error,latency_ms) VALUES(?,?,?,?,?,?,?)",
                  (iso_utc(), account, source, int(bool(ok)), new_tweets, error, latency_ms))


def recent_polls(limit=30):
    with _db() as c:
        rows = c.execute("SELECT * FROM polls ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
        return [dict(r) for r in rows]


def set_health(source, healthy, error=None):
    with _db() as c:
        row = c.execute("SELECT failures, last_ok FROM source_health WHERE source=? LIMIT 1", (source,)).fetchone()
        failures = 0 if healthy else ((row["failures"] if row else 0) + 1)
        last_ok = iso_utc() if healthy else (row["last_ok"] if row else None)
        last_error = None if healthy else error
        c.execute("INSERT OR REPLACE INTO source_health(source,healthy,failures,last_ok,last_error,updated_at) VALUES(?,?,?,?,?,?)",
                  (source, int(bool(healthy)), failures, last_ok, last_error, iso_utc()))


def get_healths():
    with _db() as c:
        rows = c.execute("SELECT * FROM source_health").fetchall()
        return {r["source"]: dict(r) for r in rows}


def log_notify(tweet_id, channel, ok, error):
    with _db() as c:
        c.execute("INSERT INTO notify_log(ts,tweet_id,channel,ok,error) VALUES(?,?,?,?,?)",
                  (iso_utc(), tweet_id, channel, int(bool(ok)), error))
