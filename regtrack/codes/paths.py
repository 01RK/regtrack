"""运行资源与用户数据的目录解析。

单文件 PyInstaller 会把模板、静态资源和 SQL 解压到 sys._MEIPASS 临时目录，
但数据库必须持久化在 exe 同级目录下，因此两者分开解析。
"""

import sys
from pathlib import Path

RESOURCE_DIR = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent.parent))
APP_DIR = (Path(sys.executable).resolve().parent
           if getattr(sys, "frozen", False) else RESOURCE_DIR)
DATA_DIR = APP_DIR / "data"
DEFAULT_DB = DATA_DIR / "regtrack-v0.19-fix3.db"
