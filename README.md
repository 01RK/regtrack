# RegTrack v24-cloud.1

面向单台 Linux 云服务器的融合版。以 6.1sol 为核心，吸收 5.5opus 的文件覆盖确认、子文件夹删除、工作组文件保护与 PostgreSQL 故障处理方式。两个输入版本均保持原样。

同事通过 HTTPS 浏览器访问。服务器统一运行一个 Waitress 应用进程和一个采集调度器，PostgreSQL 与 MinIO / S3 服务也可部署在同一台服务器。业务包括标准生命周期、草案与 Excel 原文导入、比对、批注与意见、工作组会议、事项、自动采集和通知、数据交换，以及按工作组和标准阶段管理文件。

- [版本对比与融合取舍](regtrack/docs/MERGE_REVIEW_ZH.md)
- [单服务器部署、备份与恢复](regtrack/docs/DEPLOYMENT_ZH.md)
- [文件管理](regtrack/docs/FILE_MANAGEMENT_ZH.md)
- [测试运行方法](regtrack/docs/TESTING.md)
- [融合版实际验证结果](regtrack/docs/VALIDATION_REPORT.md)

部署配置在 `deploy/`。运行依赖为 Python 3.11+、PostgreSQL 16+、MinIO SDK 兼容的 S3 服务。客户端无需安装程序；此版本不包含 Windows EXE 或多客户端部署入口。

操作人用于业务署名，访问入口由 Caddy HTTPS + Basic Auth 保护；也可使用公司统一认证网关。当前没有应用内角色权限。初始化只面向空库与专用空桶，不提供旧库迁移或兼容层。
