# 开发说明

以 DEPLOYMENT_ZH.md 为运行与部署依据。
- db.py：psycopg 原生 SQL、连接池、请求事务、业务编号。
- storage.py：MinIO SDK 客户端与流式对象操作。
- files.py：原草案图片调用入口，后端仅为 MinIO。
- api/file_manager.py：归属校验、目录、上传下载、元数据。
- sql/schema.sql：全新 PostgreSQL schema，不包含旧库迁移。
- run.py：Waitress 中心服务及采集调度器。
- package.py：云服务器源码打包。

所有查询使用 %s 参数，不在运行时转换旧 SQL。表名和列名来自内部固定模型，动态标识符由 psycopg.sql 处理。
保持业务模块分层，不增加本地存储回退、旧驱动或数据库模拟器。
