#!/usr/bin/env python3
"""下载前端依赖到 static/vendor/，之后系统完全离线可用。

只需联网执行一次：

    python codes/fetch_vendor.py

如果所在网络访问不了 CDN，可以手工把下面 4 个文件下载后按同名放进
static/vendor/ 目录，效果完全相同。
"""

import sys
import urllib.request
from pathlib import Path

VENDOR = Path(__file__).resolve().parent.parent / "static" / "vendor"

ASSETS = {
    "bootstrap.min.css":
        "https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css",
    "bootstrap.bundle.min.js":
        "https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js",
    "tom-select.bootstrap5.min.css":
        "https://cdn.jsdelivr.net/npm/tom-select@2.3.1/dist/css/tom-select.bootstrap5.min.css",
    "tom-select.complete.min.js":
        "https://cdn.jsdelivr.net/npm/tom-select@2.3.1/dist/js/tom-select.complete.min.js",
}


def main() -> int:
    VENDOR.mkdir(parents=True, exist_ok=True)
    failed = []
    for name, url in ASSETS.items():
        target = VENDOR / name
        if target.exists() and target.stat().st_size > 0:
            print(f"跳过（已存在） {name}")
            continue
        try:
            print(f"下载 {name} …", end=" ", flush=True)
            with urllib.request.urlopen(url, timeout=30) as resp:
                target.write_bytes(resp.read())
            print(f"完成 {target.stat().st_size // 1024} KB")
        except Exception as exc:                      # noqa: BLE001
            print(f"失败：{exc}")
            failed.append((name, url))

    if failed:
        print("\n以下文件没能下载，请手工获取后放入 static/vendor/：")
        for name, url in failed:
            print(f"  {name}\n    {url}")
        return 1
    print(f"\n前端依赖已就绪：{VENDOR}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
