#!/usr/bin/env python3
"""生成单机发布包。

在 Windows 上优先使用 PyInstaller 生成无需 Python 环境的 release/RegTrack.exe；
若当前环境没有 PyInstaller，则生成带便携 Python 的 release/RegTrack.bat。
发布包首次启动会在启动器所在目录的 data/regtrack.db 创建空数据库，绝不灌入 seed.sql。
"""
from pathlib import Path
import shutil
import subprocess
import sys
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "release"

def main() -> int:
    OUT.mkdir(exist_ok=True)
    exe = shutil.which("pyinstaller")
    if exe:
        cmd = [exe, "--noconfirm", "--clean", "--onefile", "--name", "RegTrack",
               "--distpath", str(OUT),
               "--workpath", str(ROOT / "build"),
               "--specpath", str(ROOT),
               "--add-data", f"{ROOT / 'templates'}{';' if sys.platform == 'win32' else ':'}templates",
               "--add-data", f"{ROOT / 'static'}{';' if sys.platform == 'win32' else ':'}static",
               "--add-data", f"{ROOT / 'sql'}{';' if sys.platform == 'win32' else ':'}sql",
               str(ROOT / "codes" / "run.py")]
        subprocess.run(cmd, cwd=ROOT, check=True)
        built = OUT / ("RegTrack.exe" if sys.platform == "win32" else "RegTrack")
        print(f"发布文件已生成：{OUT / built.name}")
        return 0
    launcher = OUT / "RegTrack.bat"
    # Windows 无 PyInstaller 时，下载官方 embeddable runtime，生成真正免安装的便携包。
    if sys.platform == "win32":
        runtime = OUT / "runtime"
        runtime.mkdir(exist_ok=True)
        py = runtime / "python.exe"
        if not py.exists():
            archive = OUT / "python-embed.zip"
            url = "https://www.python.org/ftp/python/3.12.10/python-3.12.10-embed-amd64.zip"
            print("正在下载便携 Python 运行时…")
            urllib.request.urlretrieve(url, archive)
            with zipfile.ZipFile(archive) as zf: zf.extractall(runtime)
            archive.unlink()
        app_out = OUT / "app"
        if app_out.exists():
            shutil.rmtree(app_out)
        shutil.copytree(
            ROOT,
            app_out,
            dirs_exist_ok=True,
            ignore=shutil.ignore_patterns("release", "build", "dist", "regtrack.db"),
        )
        launcher.write_text('@echo off\ncd /d "%~dp0app"\nset PYTHONPATH=.deps\n"%~dp0runtime\\python.exe" codes\\run.py\npause\n', encoding="utf-8")
        print(f"已生成免 Python 便携启动包：{launcher}")
    else:
        launcher.write_text('@echo off\ncd /d "%~dp0.."\npython codes\\run.py\npause\n', encoding="utf-8")
        print(f"未找到 PyInstaller，已生成开发机启动脚本：{launcher}")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
