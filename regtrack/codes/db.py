"""SQLite 连接管理与最小查询助手。

只用标准库 sqlite3：本系统是单机内部工具，表结构由 sql/schema.sql 明确定义，
再叠一层 ORM 只会增加而不是降低复杂度。
"""

import sqlite3
from pathlib import Path

from flask import current_app, g

import paths

SCHEMA_PATH = paths.RESOURCE_DIR / "sql" / "schema.sql"
SEED_PATH = paths.RESOURCE_DIR / "sql" / "seed.sql"


def get_db() -> sqlite3.Connection:
    """取得当前请求的连接（每请求一个，请求结束自动关闭）。"""
    if "db" not in g:
        conn = sqlite3.connect(
            current_app.config["DATABASE"],
            detect_types=sqlite3.PARSE_DECLTYPES,
            timeout=15,
        )
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        # 浏览器会并发提交（保存主档的同时写字典），WAL 让读写互不阻塞，
        # busy_timeout 则把偶发的写锁等待交给 SQLite 自己重试，而不是直接报错。
        conn.execute("PRAGMA journal_mode = WAL")
        conn.execute("PRAGMA busy_timeout = 8000")
        g.db = conn
    return g.db


def close_db(exc=None):
    conn = g.pop("db", None)
    if conn is not None:
        conn.close()


# --------------------------------------------------------------------- #
# 查询助手
# --------------------------------------------------------------------- #
def query(sql: str, params=()) -> list[dict]:
    return [dict(r) for r in get_db().execute(sql, params).fetchall()]


def query_one(sql: str, params=()) -> dict | None:
    row = get_db().execute(sql, params).fetchone()
    return dict(row) if row else None


def execute(sql: str, params=()) -> sqlite3.Cursor:
    return get_db().execute(sql, params)


def commit():
    get_db().commit()


def rollback():
    """回滚当前请求的事务；本请求还没建立连接时什么也不做。"""
    conn = g.get("db")
    if conn is not None:
        conn.rollback()


def insert(table: str, data: dict) -> int:
    """按 dict 插入一行，返回新 id。"""
    cols = list(data)
    sql = (
        f"INSERT INTO {table} ({', '.join(cols)}) "
        f"VALUES ({', '.join('?' for _ in cols)})"
    )
    cur = execute(sql, [data[c] for c in cols])
    return cur.lastrowid


def update(table: str, row_id: int, data: dict) -> None:
    if not data:
        return
    cols = list(data)
    sql = f"UPDATE {table} SET {', '.join(c + ' = ?' for c in cols)} WHERE id = ?"
    execute(sql, [data[c] for c in cols] + [row_id])


def delete(table: str, row_id: int) -> None:
    execute(f"DELETE FROM {table} WHERE id = ?", (row_id,))


def next_serial(table: str, column: str, prefix: str, year: str) -> str:
    """生成 PREFIX-YYYY-NNN 形式的业务编号（会议号 / 事项号 / 意见号）。"""
    like = f"{prefix}-{year}-%"
    row = get_db().execute(
        f"SELECT {column} AS v FROM {table} WHERE {column} LIKE ? "
        f"ORDER BY {column} DESC LIMIT 1",
        (like,),
    ).fetchone()
    seq = int(row["v"].rsplit("-", 1)[1]) + 1 if row else 1
    return f"{prefix}-{year}-{seq:03d}"


# --------------------------------------------------------------------- #
# 初始化
# --------------------------------------------------------------------- #
def init_db(db_path: Path, with_seed: bool = True) -> None:
    """建库建表（+ 模拟数据）。目标文件必须不存在或已被调用方删除。"""
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
    if with_seed and SEED_PATH.exists():
        conn.executescript(SEED_PATH.read_text(encoding="utf-8"))
    conn.commit()
    conn.close()
