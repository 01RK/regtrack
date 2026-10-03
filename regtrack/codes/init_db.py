#!/usr/bin/env python3
"""建库脚本：按 sql/schema.sql 建表，并灌入 sql/seed.sql 的初始化记录。

    python codes/init_db.py              # 建库（已存在则报错退出）
    python codes/init_db.py --force      # 删掉旧库重建
    python codes/init_db.py --empty      # 建空库，不灌初始化记录
"""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from app import DEFAULT_DB          # noqa: E402
from app import init_db          # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="初始化法规跟踪系统数据库")
    parser.add_argument("--db", default=str(DEFAULT_DB), help="数据库文件路径")
    parser.add_argument("--force", action="store_true", help="已存在时先删除再重建")
    parser.add_argument("--empty", action="store_true", help="不灌入初始化记录")
    args = parser.parse_args()

    path = Path(args.db)
    if path.exists():
        if not args.force:
            print(f"数据库已存在：{path}\n加 --force 可删除重建（现有数据会丢失）。")
            return 1
        path.unlink()

    init_db(path, with_seed=not args.empty)
    print(f"数据库已就绪：{path}")
    print("初始化记录：未灌入（--empty）" if args.empty else "初始化记录：已灌入")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
