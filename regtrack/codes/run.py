#!/usr/bin/env python3
"""本地启动入口。

    python codes/run.py                 # http://127.0.0.1:5000
    python codes/run.py --port 8080     # 换端口
    python codes/run.py --host 0.0.0.0  # 允许同一局域网的同事访问
"""

import argparse
import webbrowser
from pathlib import Path
from threading import Timer
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from app import DEFAULT_DB, create_app

VENDOR = Path(__file__).resolve().parent.parent / "static" / "vendor"
VENDOR_FILES = ["bootstrap.min.css", "bootstrap.bundle.min.js",
                "tom-select.bootstrap5.min.css", "tom-select.complete.min.js",
                "marked.umd.js", "purify.min.js", "sortable.min.js", "katex/katex.min.css",
                "katex/katex.min.js", "katex/fonts/KaTeX_Main-Regular.woff2"]


def preflight(db_path: Path) -> bool:
    missing = [f for f in VENDOR_FILES if not (VENDOR / f).exists()]
    if missing:
        print("! 缺少前端依赖文件：" + "、".join(missing))
        print("  执行 python codes/fetch_vendor.py 下载（只需联网一次）。")
        print("  现在仍会启动，但页面样式和下拉框不会正常显示。\n")
    # create_app() 会在首次启动时自动创建空库；这里不再要求用户手工执行 init_db.py。
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description="启动法规跟踪系统")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=5000)
    parser.add_argument("--db", default=str(DEFAULT_DB))
    parser.add_argument("--debug", action="store_true")
    parser.add_argument("--no-browser", action="store_true", help="不自动打开浏览器")
    args = parser.parse_args()

    db_path = Path(args.db)
    if not preflight(db_path):
        return 1

    url = f"http://{'127.0.0.1' if args.host == '0.0.0.0' else args.host}:{args.port}/"
    print(f"法规跟踪系统已启动：{url}")
    print(f"数据库：{db_path}")
    print("按 Ctrl+C 停止。\n")
    if not args.no_browser and not args.debug:
        Timer(1.0, lambda: webbrowser.open(url)).start()

    create_app(db_path).run(host=args.host, port=args.port, debug=args.debug)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
