# 法规跟踪系统 RegTrack

按《法规跟踪系统 Forms 与 Subforms 设计说明》实现的本地系统：
Python（Flask）+ SQLite + HTML，本地运行，不需要部署。

覆盖文档中的 5 个主入口与全部子表：

1. **标准主档 Standard Profile** → 子表：Stage History 阶段历史（推进 / 补录）
2. **草案登记 Draft Registry** → 子表：Clause Evolution 条款变化（全系统唯一录入入口）
3. **工作组会议 WG Meeting** → 一场会议可挂多项标准 + 按标准行内一键派生 5 类事项
   （总览页另有「今年已参加的工作组会议」一块，按参会人与时间范围筛选）
4. **意见矩阵 Comment Matrix** → 子表：Comment Status History 意见状态历史
5. **事项 Action Item**（5 个子类型）→ 子表：Feedback Recipients 反馈对象

以及文档 §6 的通用状态机制、跨 Form 联动（标准搜索下拉底部就地建档并回选、
会议派生事项、反馈对象一键生成意见）。跨记录查看按业务方向在当前弹窗上叠一层：
标准向下查看草案 / 会议 / 意见 / 事项，会议查看派生事项，事项查看生成意见；
来源字段只展示不反向跳转，避免循环打开。弹窗带面包屑与「返回」按钮，悬浮时提示返回目标。

标准生命周期为九个阶段：预研 → 立项 → 起草 → 征求意见稿 → 送审稿 → 报批稿 →
发布 → 实施 → 废止。阶段在系统内部以固定编码（`PRE_RESEARCH`、`PROJECT_APPROVAL`…）
存取，界面只负责显示名称。同一入口「推进 / 补录阶段」兼顾两种记录：选当前阶段之后的
阶段为正常推进，选当前阶段之前尚未填写的阶段为历史补录——可填真实发生时间，
并在记录上留痕以便审计。阶段记录不锁定：推进与补录都能更正生效日期、依据与说明，
每条记录同时显示创建时间与最近修改时间（含操作人）；阶段本身不可改写，换阶段是另一条
记录。当前阶段由阶段记录自动算出，标准主档不能直接改写。删除操作执行的是归档：
数据完整保留，可随时恢复。

事项、意见矩阵、草案版本和条款变化检索统一按标准分组：默认全部展开，支持单组及
全部展开/收起。筛选只保留符合条件的记录；组内按系统登记时间倒序，标准组则按组内
最新登记记录倒序。分页以标准组为单位，同一标准不会被拆到两页。

## 快速开始

### 用户端（Windows）

直接双击 release/RegTrack.exe。首次启动会在 exe 同级的 data/regtrack.db
自动创建空数据库，之后继续使用同一个数据库；不会加载 sql/seed.sql 模拟数据。

```bash
# 开发机从源码启动（需要 Python）
pip install -r requirements.txt
python codes/run.py              # 首次启动自动创建空库
```

sql/seed.sql 只用于开发验证；需要演示数据时才手工执行
python codes/init_db.py --force， 不要在生产发布包中执行。

## 文档

- **[docs/README_USER.md](docs/README_USER.md)** — 使用者说明：安装、日常操作、常见问题
- **[docs/README_DEV.md](docs/README_DEV.md)** — 开发者说明：数据库设计、接口清单、如何改字段

## 目录

```
codes/              全部 Python 代码（应用、接口、工具和测试）
  app.py            应用工厂、页面路由与统一错误处理
  constants.py      固定值唯一定义源（含阶段编码表）
  db.py             SQLite 连接、查询助手与建库
  common.py         校验、清洗、当前操作人、ApiError
  stages.py         阶段服务：推进 / 补录、当前阶段计算
  status.py         意见 / 事项 / 反馈对象的通用状态历史
  lookups_service.py 字典写入服务（业务录入时自动补字典）
  grouped.py        跨记录列表的按标准分组
  lifecycle.py      生命周期回顾与 Markdown 导出
  api/              五个主入口的 HTTP 接口，按 Form 分模块
  run.py            启动入口
  init_db.py        数据库初始化入口
  fetch_vendor.py   前端依赖下载入口
  test_api.py       接口冒烟测试
sql/schema.sql     建表 SQL（14 张表 + 索引 + 视图）
static/js/records.js  五类记录的明细与表单（全站共用，负责叠层与返回）
static/js/stage-manager.js  阶段时间轴、推进 / 补录与阶段详情
static/js/grouped-list.js  标准分组列表的展开、收起与无障碍状态
sql/seed.sql       模拟数据（阶段/状态历史均为逐级完整的链条，含历史补录示例）
templates/         页面骨架
static/            样式与前端脚本
```
