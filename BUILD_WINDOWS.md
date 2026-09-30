# Windows 发布构建

在 Windows 的 Python 环境中进入 `regtrack` 目录后执行：

```powershell
python -m pip install -r requirements.txt
python codes/package.py
```

脚本会用 PyInstaller 生成 `release/RegTrack.exe`。用户双击该 exe 时，应用会自动在
exe 同级的 `data\regtrack.db` 建立空库；`sql/seed.sql` 不会被执行。

`seed.sql` 仅供开发验证，需要演示数据时才运行 `python codes/init_db.py --force`。
