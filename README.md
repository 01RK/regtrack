# RegTrack 法规跟踪系统

RegTrack 是一个本地运行的法规与标准跟踪工具，使用 Python、Flask 和 SQLite 构建。它帮助个人或团队集中管理标准生命周期、草案版本、工作组会议、意见和后续事项。数据保存在本机 SQLite 数据库中。

## 功能

- 管理标准主档及从预研、立项到实施、废止的阶段历史
- 登记草案版本和条款变化
- 记录工作组会议及会议关联的标准
- 跟踪意见、事项、状态变化和反馈对象
- 查看标准生命周期回顾并导出 Markdown
- 按标准分组检索相关记录，并支持数据导入与导出

## 环境要求

- Python 3.10 或更高版本
- Windows、macOS 或 Linux
- 首次安装前端静态依赖时需要联网；依赖下载后可离线运行

## 从源码运行

在仓库根目录执行：

```powershell
cd regtrack
py -3 -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python codes/fetch_vendor.py
python codes/run.py
```

然后在浏览器打开 <http://127.0.0.1:5000>。首次启动会创建空数据库；应用数据默认保存在 `regtrack/data/`，该目录中的本地数据库不会提交到 Git。

macOS / Linux 可将虚拟环境激活命令替换为：

```bash
source .venv/bin/activate
```

更多启动选项、数据库说明和开发信息见：

- [用户使用说明](regtrack/docs/README_USER.md)
- [开发者说明](regtrack/docs/README_DEV.md)
- [Windows 构建说明](BUILD_WINDOWS.md)

## Windows 打包

在 Windows 上进入 `regtrack/` 目录，安装项目依赖后运行打包脚本：

```powershell
cd regtrack
python -m pip install -r requirements.txt
python codes/package.py
```

如果当前 Python 环境已安装 PyInstaller，脚本会生成 `regtrack/release/RegTrack.exe`。未安装 PyInstaller 时，脚本会尝试下载 Python 便携运行时并生成 `regtrack/release/RegTrack.bat` 及配套文件。脚本需要网络访问以下载尚未缓存的运行时。发布包首次启动会创建空数据库，不会自动载入模拟数据。更多说明见 [Windows 构建说明](BUILD_WINDOWS.md)。

## 开发数据

默认启动使用空数据库。开发时如需装入模拟数据，可在 `regtrack/` 目录执行：

```bash
python codes/init_db.py
```

`sql/seed.sql` 包含具身智能机器人行业的虚构演示数据，涵盖机器人安全、任务基准、操作臂、网络安全和数据治理。人物、机构、编号和业务描述均为模拟内容；示例链接使用 `example.invalid` 保留域名。请勿将真实法规跟踪数据放入该文件。`--force` 会重建数据库并删除当前本地数据；使用前请备份。

初始化脚本默认会拒绝覆盖已有数据库。需要明确重建时，在 `regtrack/` 目录执行：

```powershell
python codes/init_db.py --force
```

该命令会**删除目标数据库文件后重新建库，并默认灌入 `sql/seed.sql` 中的模拟数据**。目标路径默认为 `regtrack/data/regtrack.db`；如需指定其他文件，可使用 `--db`：

```powershell
python codes/init_db.py --db data/demo.db --force
```

仅建空库、不导入模拟数据时，组合使用 `--empty`：

```powershell
python codes/init_db.py --force --empty
```

`--force` 会永久删除指定路径下的现有数据库内容；运行前请确认路径并备份需要保留的数据。日常启动应用不需要使用此选项。

## 前端依赖

Bootstrap 和 Tom Select 的静态文件存放在 `regtrack/static/vendor/`，应用运行时不依赖 CDN。有关依赖来源和许可信息，请参阅 [`regtrack/static/vendor/README.md`](regtrack/static/vendor/README.md)。

## 许可证

本项目采用 [MIT License](LICENSE)。第三方组件各自遵循其对应许可证。
