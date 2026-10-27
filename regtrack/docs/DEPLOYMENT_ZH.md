# 单台 Linux 云服务器部署

目标结构：一台服务器运行 PostgreSQL、MinIO / S3、一个 RegTrack 服务和 Caddy。用户只访问 HTTPS 域名。不启动多个应用实例；采集调度器由 codes/run.py 统一启动。以下按 Ubuntu 24.04、Python 3.12、PostgreSQL 16 和 Caddy 2.8+ 编写。

## 1. 安装服务与应用

安装系统 Python、venv、PostgreSQL 和 Caddy。S3 服务使用公司批准的 MinIO / AIStor 发行渠道安装在同机，按该发行版官方说明配置开机启动、持久数据目录和服务账号。应用所需是兼容 MinIO Python SDK 的 S3 API；不依赖控制台。不要把测试用 Moto 用于部署。

- PostgreSQL 仅监听 127.0.0.1:5432。
- 同机 S3 API 仅监听 127.0.0.1:9000；管理端口不对公网开放。
- Waitress 仅监听 127.0.0.1:5000。
- 云安全组只对用户开放 80/443；管理 SSH 按公司策略限制。

将本目录部署为 `/opt/regtrack`（包含 deploy/、regtrack/、README.md）：

```bash
sudo useradd --system --home /opt/regtrack --shell /usr/sbin/nologin regtrack
sudo python3 -m venv /opt/regtrack/.venv
sudo /opt/regtrack/.venv/bin/pip install -r /opt/regtrack/regtrack/requirements.txt
sudo install -d -m 750 -o root -g regtrack /etc/regtrack
sudo install -m 640 -o root -g regtrack /opt/regtrack/deploy/regtrack.env.example /etc/regtrack/regtrack.env
sudoedit /etc/regtrack/regtrack.env
```

替换所有 CHANGE_ME。数据库 URL 密码中的 `@ : / % #` 等字符须按 URL 编码填写。EnvironmentFile 每行 `KEY=value`，不要写 export、shell 命令或在值后加行内注释。配置文件不打进源码包。

建议以 4 核 / 8 GB RAM / SSD 作为约 50 人团队的验收起点；实际资源按附件与业务数据规模确定，不能以此保证容量。

## 2. 创建空数据库和初始化

```bash
sudo -u postgres createuser --pwprompt regtrack
sudo -u postgres createdb --owner=regtrack --encoding=UTF8 --template=template0 regtrack
```

为应用创建专用 S3 桶，并授权仅该桶的读取、写入、删除和列表操作（包括上传 SDK 所需的分段上传权限）。也可在首次初始化时使用可建桶的管理员凭据，再换成限桶应用凭据。实际环境变量只保存在服务器。

在项目目录通过临时 systemd 单元读取同一配置进行初始化：

```bash
sudo systemd-run --wait --pipe --collect --uid=regtrack --gid=regtrack   --working-directory=/opt/regtrack/regtrack   --property=EnvironmentFile=/etc/regtrack/regtrack.env   /opt/regtrack/.venv/bin/python codes/init_db.py --empty
```

只运行一次。初始化遇到已有表或非空桶会拒绝继续，不清空原有数据。不加 --empty 会导入演示业务及附图，生产环境使用 --empty。

## 3. 启动应用和 HTTPS 入口

```bash
sudo install -m 644 /opt/regtrack/deploy/regtrack.service /etc/systemd/system/regtrack.service
sudo systemctl daemon-reload
sudo systemctl enable --now regtrack
curl --fail http://127.0.0.1:5000/healthz
sudo journalctl -u regtrack -n 100 --no-pager
```

`/healthz` 检查数据库查询与桶可达性；`codes/check_services.py` 进一步验证临时对象上传、读取和删除。执行方式与初始化的 systemd-run 相同，将命令改为 `codes/check_services.py`。

将 deploy/Caddyfile 复制到 `/etc/caddy/Caddyfile`，替换域名和认证信息。域名 DNS 指向此服务器；用 `caddy hash-password` 交互生成密码哈希（不要填明文密码）。可在 basic_auth 块配置多名同事的独立账号。Caddy 负责 HTTPS 证书申请与续期。公司已有 SSO 网关时，在入口使用公司认证策略。

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

浏览器访问 `https://你的域名`，完成入口认证后选择业务操作人。入口账号只控制访问，业务署名仍按页面选择；本版没有应用内角色与逐条记录授权。不要把 5000 端口绑定到公网绕过入口。

## 4. 运行与更新

`REGTRACK_MAX_UPLOAD_MB` 是整个 HTTP 请求上限（包含 multipart 开销），默认 100 MB；前置网关如另设上限须协调。数据库池默认最多 16 条连接、Waitress 32 线程，统一服务所有浏览器。服务通过 TZ=Asia/Shanghai 统一业务时间，采集模块也固定使用北京时间。

更新：停止 regtrack，保留服务器上的配置与数据，替换应用源码，重新安装 requirements.txt，再启动服务并检查 healthz。版本 schema 不符会拒绝启动；本版只支持新库，不提供结构迁移。日志通过 journalctl 查看。不在每位同事电脑分发数据库或对象存储密码。

## 5. 配对备份与恢复

先 `systemctl stop regtrack`，等待退出，暂停业务和采集写入，再做同一停写窗口的两份备份：

1. 用 `pg_dump -Fc` 备份 regtrack 数据库（交互密码或受权限保护的 .pgpass）。
2. 用 S3 服务官方工具（例如已配置限权别名的 `mc mirror`）完整备份 regtrack 桶，保持对象键不变。
3. 另存 /etc/regtrack/regtrack.env 与入口配置，限制文件权限并加密存放。备份成功后启动 regtrack。

不要把数据备份写在源码目录内。单独备份 PG 或 S3 都不足以完整恢复。

恢复到新的空数据库和专用空桶：停应用，用 pg_restore 恢复数据库，用对象服务工具恢复桶，填好服务环境变量，执行 check_services.py 与 storage_audit.py，确认无 MISSING，再启动应用并抽查草案附图、文件下载、标准列表和采集配置。恢复已包含 schema，不再运行 init_db.py。定期实际演练恢复。

对象删除失败只记服务器日志，不把已提交成功的业务误报为失败；此时运行只读审计，核对 UNREFERENCED。审计不会自动删除任何对象。真实云服务、证书、访问策略、备份恢复和混合负载均须在目标服务器验收。
