# 测试与验收

## 自动化回归

需要独立 PostgreSQL UTF8 测试数据库，测试账号可在其中创建/删除 schema。不要使用真实业务库。
测试为每个场景创建随机命名 schema，结束后删除；不使用旧数据库驱动、SQLite 或数据库模拟器。
对象协议测试由 Moto 在本机自动分配的空闲端口提供 S3 测试服务，调用的仍是官方 MinIO Python SDK。它不是实际 MinIO 服务，不能代替目标环境联调。

```powershell
cd regtrack
python -m pip install -r requirements-test.txt
$env:REGTRACK_TEST_ADMIN_DSN = "postgresql://test_admin:TEST_PASSWORD@127.0.0.1:5432/regtrack_tests"
python -m pytest codes -q
```

数据库不存在时请由管理员先创建 UTF8 测试库。未设置测试连接字符串时数据库测试跳过，不应把跳过当作通过。
测试包括原业务接口、草案导入、图片、比对、意见、会议、follow-up、消息采集、文件归属隔离、同名冲突、对象回滚与删除。

## 真实服务联调

先按部署文档配置真实 PostgreSQL 和 MinIO，然后运行：

使用部署文档中的 systemd-run 读取服务端环境文件执行 `python codes/check_services.py`。

该命令在专用桶 healthcheck/ 前缀创建随机临时对象，读取比对后删除。它不会修改业务表。
再在浏览器实际完成草案图片导入、显示、导出及标准/工作组文件上传下载。

## 50 并发测试

```powershell
python -m pytest codes/test_native_storage.py -k "50_http or atomic_serials" -s -q
```

原子编号测试：50 个工作线程分配 100 个编号，检查不重复。
HTTP 测试：真实 Waitress 服务 32 个线程、数据库池默认最多 16 条连接，50 个 HTTP 客户端同步起步，各执行 1 次标准创建和 4 次列表读取，共 250 个请求。
输出 LOAD_RESULT，含错误数、95% 请求耗时和最长耗时。测试对象服务仍为 Moto，HTTP 测试本身不包含大文件传输。

目标环境必须另测：真实 MinIO、大文件、工作簿导入/导出、实际数据库规模、企业网络、持续运行、断网恢复和备份恢复。
本地测试数据库可能为提高测试速度关闭持久化刷盘；这种设置不允许用于生产，耗时也不能作为生产性能承诺。

## 融合回归

`test_cloud.py` 覆盖显式覆盖确认、覆盖数据库失败后旧文件保留、递归删除隔离、工作组文件保护、超过 999 与数据导入后的编号、文件夹删除与上传竞争、锁等待分类、上传上限与 healthz。测试使用真实 PostgreSQL 和 MinIO SDK + Moto。

最新实际执行结果只见 VALIDATION_REPORT.md，不沿用输入版本成绩。Linux systemd 与真实 S3 部署须在目标服务器验收。
