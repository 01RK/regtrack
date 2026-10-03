#!/usr/bin/env python3
"""使用 PyInstaller 生成单文件发布包。"""
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "release"

def main() -> int:
    exe = shutil.which("pyinstaller")
    if not exe:
        print("请先安装打包依赖：python -m pip install pyinstaller")
        return 1
    OUT.mkdir(exist_ok=True)
    separator = ";" if sys.platform == "win32" else ":"
    cmd = [exe, "--noconfirm", "--clean", "--onefile", "--name", "RegTrack",
           "--distpath", str(OUT), "--workpath", str(ROOT / "build"),
           "--specpath", str(ROOT)]
    for directory in ("templates", "static", "sql"):
        cmd += ["--add-data", f"{ROOT / directory}{separator}{directory}"]
    cmd.append(str(ROOT / "codes" / "run.py"))
    subprocess.run(cmd, cwd=ROOT, check=True)
    built = OUT / ("RegTrack.exe" if sys.platform == "win32" else "RegTrack")
    print(f"发布文件已生成：{built}")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
