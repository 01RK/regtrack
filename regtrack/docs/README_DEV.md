# 法规跟踪系统 · 开发者说明

面向要改代码、改字段、改校验规则的人。只想把系统跑起来用，请看 `README_USER.md`。

---

## 1. 技术选型

| 层 | 选型 | 说明 |
| --- | --- | --- |
| Web 框架 | Flask 3.x | 只用到路由、Blueprint、Jinja2、jsonify |
| 数据库 | SQLite（标准库 `sqlite3`） | 单文件库，无服务端进程；未引入 ORM |
| 模板 | Jinja2（Flask 自带） | 只渲染页面骨架，数据全部走 JSON 接口 |
| 前端框架 | 无（原生 ES6） | 无构建步骤，改完刷新即生效 |
| UI 库 | Bootstrap 5.3.3 | 栅格、模态框、表单控件 |
| 可搜索下拉 | Tom Select 2.3.1 | 标准 / 草案 / 会议 / 字典项的搜索选择 |

除 Flask 外没有 Python 第三方依赖。前端两个库以静态文件放在 `static/vendor/`，
不走 CDN，联网下载一次之后系统完全离线可用。

## 2. 环境准备

要求 Python 3.10+（代码里用了 `str | Path` 写法）。

```bash
cd regtrack
python -m venv .venv
# Windows: .venv\Scripts\activate
source .venv/bin/activate

pip install -r requirements.txt      # 只装 Flask
python codes/fetch_vendor.py         # 下载前端依赖，需联网，只需一次
python codes/init_db.py              # 建库 + 灌初始化记录
python codes/run.py              # http://127.0.0.1:5000
```

`codes/fetch_vendor.py` 会把 4 个文件下载到 `static/vendor/`：
`bootstrap.min.css`、`bootstrap.bundle.min.js`、`tom-select.bootstrap5.min.css`、
`tom-select.complete.min.js`。所在网络访问不了 jsDelivr 的话，手工下载后按同名
放进该目录效果完全一样，脚本里有对应 URL。缺文件时 `run.py` 会打印警告但仍会启动，
页面能出内容，只是样式和下拉框不正常。

常用参数：

```bash
python codes/run.py --port 8080          # 换端口
python codes/run.py --host 0.0.0.0       # 同一局域网的同事可访问
python codes/run.py --debug              # 代码改动自动重载，不自动开浏览器
python codes/run.py --db /tmp/x.db       # 指定其它库文件

python codes/init_db.py --force    # 删掉旧库重建（现有数据会丢）
python codes/init_db.py --empty    # 建空库，不灌初始化记录（上线用这个）
```

## 3. 目录结构

```
regtrack/
├── codes/                  全部 Python 代码（应用、接口、工具和测试）
│   ├── app.py              应用工厂、页面路由与统一错误处理
│   ├── paths.py            资源目录与数据目录解析（兼顾 PyInstaller）
│   ├── constants.py        固定值唯一定义源（含阶段编码表）
│   ├── db.py               SQLite 连接与查询助手、建库
│   ├── common.py           校验、清洗、当前操作人、ApiError
│   ├── stages.py           阶段服务：推进 / 补录、当前阶段计算
│   ├── status.py           意见 / 事项 / 反馈对象的通用状态历史
│   ├── lookups_service.py  字典写入服务（业务录入时自动补字典）
│   ├── grouped.py          跨记录列表的按标准分组
│   ├── lifecycle.py        生命周期回顾与 Markdown 导出
│   ├── api/                五个主入口的 HTTP 接口，按 Form 分模块
│   ├── run.py              启动入口
│   ├── init_db.py          数据库初始化入口
│   ├── fetch_vendor.py     前端依赖下载入口
│   └── test_api.py         接口冒烟测试
├── templates/              页面骨架
├── static/                 样式与前端脚本
├── sql/                    数据库 SQL
└── docs/
```

## 4. 数据库设计

16 张表 + 2 个视图，DDL 见 `sql/schema.sql`。

| 表 | 对应文档 | 要点 |
| --- | --- | --- |
| `standard` | Form 1 标准主档 | 主键 `id`，`std_no` 唯一；`stage_code` 由阶段记录算出；`archived_at` 置位即归档 |
| `standard_impact_area` | 标准的影响领域 | 多值字段拆成关联表 |
| `draft` | Form 2 草案登记 | `(standard_id, version_name, draft_sub_version_no)` 唯一 |
| `draft_import` | 当前草案导入批次 | 保存文件名、来源版本文字与操作者；替换后仅保留当前批次 |
| `draft_chapter` | 当前草案章节 | 归属当前导入批次，替换时旧章节删除 |
| `draft_annotation` | 草案批注 | 可关联整份草案或单个章节；每章唯一；Excel 的 `Initial_Comment` 与人工内容共用 `content`，无来源字段，创建/修改时间和操作人均留存 |
| `meeting` | Form 3 工作组会议 | `meeting_no` 形如 `MTG-2026-001` |
| `meeting_standard` | 会议涉及标准 | 多对多，主键 `(meeting_id, standard_id)`；`note` 是「这场会 × 这项标准」的批注，随关联存亡 |
| `comment` | Form 4 意见矩阵 | `comment_no` 形如 `CM-2026-001` |
| `action_item` | Form 5 事项 | 5 个子类型同表，`item_no` 形如 `AI-2026-001` |
| `feedback_recipient` | Subform 反馈对象 | 挂在 Collect Comments 类事项下 |
| `standard_stage_history` | Stage History | 每标准每阶段至多一条（`UNIQUE(standard_id, stage_code)`）；`record_type` 区分推进与补录；`created_at/by` 为首次记录，`updated_at/by` 为最近修改（`updated_by IS NULL` 表示未改过） |
| `comment_status_history` | Comment Status History | 外键指向 `comment`，删除时级联 |
| `action_status_history` | Action Status History | 外键指向 `action_item`，删除时级联 |
| `recipient_status_history` | Recipient Status History | 外键指向 `feedback_recipient`，删除时级联 |
| `lookup_value` | 可维护的开放列表 | `impact_area`/`person`/`team`/`organization`/`tc_wg` |
| `v_standard_overview` | 视图 | 标准 + 草案数 / 意见数 / 在办事项数 |

几个设计取舍：

- **状态历史按业务实体拆成四张表**。每张表都有指向主记录的真实外键和
  `ON DELETE CASCADE`，数据库能直接阻止孤儿历史。
- **Action Item 五个子类型放同一张表**，子类型专有列可空，由 `item_type` 决定显示与必填。
  子类型之间共享的字段占多数，拆表会让列表页和跨类型统计变成 5 路 UNION。
- **标准阶段用固定编码，不再放进字典**。`constants.STAGES` 是唯一定义源，
  库里存 `PRE_RESEARCH` 这类编码，显示名称由 `/api/meta` 下发、前端渲染，
  以后改名称或加语言都不动数据。阶段顺序即列表顺序。
- **阶段记录分推进与补录两类**。目标阶段在当前阶段之后为 `ADVANCE`（日期不得早于
  当前阶段），在当前阶段之前且尚未填写为 `BACKFILL`（可填真实发生时间，不受顺序限制）。
  当前阶段永远取「已记录阶段中最靠后的一个」，因此补录不会改变当前阶段。
- **阶段记录不锁定**。两类记录的 `effective_date`、`reference`、`note` 都可以更正
  （`PUT /<id>/stages/<record_id>`），`stage_code` 不接受改写——换阶段等于另一条记录。
  每次修改刷新 `updated_at` / `updated_by`，`created_at` / `created_by` 保持首次记录的值；
  服务层据 `updated_by` 是否为空给出 `modified` 标志，界面同时展示这两个时间。
- **标准不做物理删除**。删除入口执行归档（`archived_at`），归档标准从列表、下拉、
  关联列表和总览统计中隐去，但主档、阶段历史与全部关联记录继续保留，可随时恢复。
- **人员 / 团队存 TEXT 而非外键**，配 `lookup_value` 做自动补全。这类系统里
  经办人经常是临时出现的外部联系人，强外键只会逼着用户先去建档。
- **不引 ORM**。查询以列表页的多条件过滤和明细页的关联聚合为主，SQL 直写比
  ORM 表达式更短也更好调。

### 通用状态机制（§6）

调用方只提交**新值 + 生效日期 + 说明**，`codes/status.py` 负责：
读出当前值写进 `previous_value`，写入记录时间与记录人，再同步更新主记录的当前值。

因此**当前值字段是只读的**：`comment.status`、`action_item.current_status`
在 PUT 接口里会被忽略，只能通过对应的状态历史接口推进。标准阶段不走这套机制，
它由 `codes/stages.py` 单独管理（见上文的推进 / 补录规则），`standard.stage_code`
同样在 PUT 里被忽略。
要新增一个受管状态字段，需要先建立带外键的专用历史表，再在状态服务的
`_TARGETS` 中登记主表、历史表和外键列，并在 `constants.STATUS_FIELDS` 中登记取值。

### 粘贴进来的文本

同事常把 Word / PDF 里的条款和公式整段复制进表单，这类文本有三类麻烦，
统一在请求入口 `common.payload_of()` 调 `sanitize()` 处理（递归覆盖子表数组与嵌套对象，
`/api/transfer/import` 的导入包也走同一套）：

- **落单的代理项**（lone surrogate）——UTF-8 编不出来，写库时抛 `UnicodeEncodeError`，
  整个请求变成 500。剔除。
- **控制字符**（NUL、垂直制表符等）——能存但检索和显示都出问题。保留换行与制表符，其余剔除。
- **符号字体的私用区码位**（U+F020–U+F0FF）——Word 公式用 Symbol / MT Extra 这类字体，
  复制出来的「≤」其实是 U+F0A3，任何正常字体都画不出来，就是「解析成乱码符号」的由来。
  按 `common.SYMBOL_FONT_MAP` 还原成真字符（≤ ≥ × ÷ ± ≠ ≈ ∞ ∑ √ ∫ 与希腊字母等）。
  **含义不明确的私用区码位原样保留**——宁可显示成方块，也不猜成别的字符。

### 固定值

`codes/constants.py` 是唯一定义源，`sql/schema.sql` 的 CHECK 约束与之保持一致做库层兜底，
前端通过 `/api/meta` 拿到全部取值渲染下拉框。**改固定值要同时改这两处**，
然后 `python codes/init_db.py --force` 重建库。

上达渠道（邮件 / 系统平台 / 会议 / 函件）是固定值，**不是字典**：
`constants.SUBMISSION_CHANNELS` 定义，`action_item` 与 `comment` 两张表都有 CHECK 约束，
两个接口各做一次 `check_enum`，前端用 `type: "fixed"` 取 `/api/meta` 的下发值。
早先前端误把它接到了机构字典上，机构名因此被写进渠道字段——加下拉时注意区分这两类。

开放列表（影响领域、人员、团队、机构、TC/WG）不属于固定值，放在 `lookup_value` 表，
在「字典维护」页增删改。**下拉框里现场输入的新值不会单独发请求**：前端只在本地登记，
保存业务记录时由 `lookups_service.ensure_values()` 在同一个事务里补进字典。
这样既不会因为「字典里没有这个值」而保存失败，也不会出现字典写进去、记录没存上的半截状态。
涉及的字段见 `constants.STANDARD_LOOKUP_FIELDS`，以及草案发布方、会议组织方、
条款跟进人、意见提交人、反馈对象团队 / 人员。

## 5. 接口一览

全部返回 JSON。写操作从 `X-User` 请求头取当前操作人，写入 `created_by` / `created_at`。

**请求体里的文本都会先过一遍 `common.sanitize()`**（见下节），所以各接口拿到的字符串
已经是能安全入库、能正常显示的。

| 前缀 | 主要端点 |
| --- | --- |
| `/api` | `GET /meta` 固定值（含阶段编码与显示名）；`GET /dashboard` 总览统计（阶段分布按阶段编码顺序输出九项，含 0 条的）；`GET /dashboard/due-actions`、`GET /dashboard/meetings` 两块清单单独取数，供筛选器局部刷新 |
| `/api/standards` | 列表（`?archived=1` 查归档）/ 详情 / 新建 / 修改；`DELETE /<id>` 归档、`POST /<id>/restore` 恢复；`GET /options` 下拉数据；`GET,POST /<id>/stages` 阶段时间轴与推进 / 补录、`PUT /<id>/stages/<record_id>` 修改阶段记录；`GET /<id>/lifecycle`；`GET /<id>/lifecycle.md` |
| `/api/drafts` | 列表 / 详情 / 增删改；`GET /options`；`POST /imports/read`、`POST /imports`、`POST /<id>/annotations` |
| `/api/transfer` | `GET /users` 登记人清单；`GET /export?user=` 按登记人导出自包含数据包；`POST /inspect` 导入前预检（包里有什么、本机有哪些操作人）；`POST /import` 确认登记人（`as_user`）后写入；字典的单独导入导出 |
| `/api/meetings` | 列表 / 详情 / 增删改（新建与修改可带 `standard_ids` 列表，按列表重设涉及标准，未提交则不改动）；`POST /<id>/standards` 追加一项、`PUT /<id>/standards/<sid>` 改这项标准在本会的批注、`DELETE /<id>/standards/<sid>` 移除一项。会删掉非空批注的操作需带 `drop_notes` 确认 |
| `/api/comments` | 列表 / 详情 / 增删改；`GET,POST /<id>/status-history` |
| `/api/actions` | 列表 / 详情 / 增删改；`GET,POST /<id>/recipients`；`PUT,DELETE /recipients/<id>`；`GET /recipients/<id>/comment-draft`；`GET,POST /<id>/status-history` |
| `/api/lookups` | `GET /<category>`、`POST /<category>`、`PUT /<id>`、`DELETE /<id>` |

错误统一返回 `{"error": "...", "field": "...", "detail": "..."}`：`error` 是给人看的原因，
`field` 让前端把焦点移到出错控件，`detail` 补上具体取值、可选值或数据库原文。
业务校验 400，找不到 404。应用工厂为 `sqlite3.IntegrityError`、其它 `sqlite3.Error`
以及**任何未处理异常**都注册了处理器，因此后端不会再向浏览器返回 HTML 错误页——
前端也就不会只看到一句 `fail to fetch`。`core.js` 另外把 `fetch` 本身的连接失败
翻译成「无法连接到本地服务」。

草案、意见和事项列表返回分组结构：`total` 是匹配记录数，
`group_total` 是匹配标准组数，`groups[].items` 是该标准下的匹配记录。`page_size`
表示每页标准组数（页面默认 10），而不是记录数；兼容字段 `items` 按组顺序平铺当前页记录。
组内按 `created_at DESC, id DESC`，组间按最新记录的 `created_at DESC, id DESC`，
再以标准编号和标准 id 保证稳定排序。事项中无标准的 Others 统一使用分组键 `0`。

### 标准生命周期回顾

`codes/lifecycle.py` 中的 `payload()` 负责归档，页面接口与导出共用：

- 阶段：已记录阶段取自 `standard_stage_history`（按生效日期排序，最后一条为当前阶段，
  被跳过的阶段自然不出现，补录进来的阶段按真实日期落位并带上 `record_type`）；
  未来阶段取自阶段编码表中排在当前阶段之后且尚无记录的项，`TERMINAL_STAGE`（废止）除外。
- 草案：先按 `VERSION_STAGES` 把版本名称映射到阶段，映射为空或该阶段未经历时，按草案日期
  落入已经历阶段的区间；早于第一条阶段历史的记录归入第一个阶段。
- 意见跟随关联草案的阶段，否则按 `submission_date`（缺省用登记日期）归档；会议按会议日期；
  事项（仅导出）依次跟随关联草案、来源会议，否则按登记日期。
- 导出模板为 `templates/exports/lifecycle.md`（Jinja2，非 HTML 不转义），带 YAML 头信息；
  `md_block` / `md_inline` 两个过滤器负责引用块与表格单元格的转义。

### 关联上的批注

`meeting_standard.note` 属于关联本身，不属于任何一侧：同一项标准在另一场会议上是另一条
批注。因此**取消挂载 = 删除批注**，凡是会抹掉非空 note 的写操作（`DELETE /<id>/standards/<sid>`、
`PUT /<id>` 里缩短 `standard_ids`）都要求带 `drop_notes` 才放行，否则返回
`DROP_NOTE_WARNING` 并在 `detail` 里列出涉及的标准编号。前端在发请求前用
`App.confirmAsync()` 先问一句——它是 `confirmDialog` 的 Promise 版，取消时返回 `false`，
适合「先问、再决定要不要继续提交」的场景（回调版在取消时不会有任何回音）。

### 数据交换

导出按登记人切片，但**沿外键做一次闭包**（`_close_over_references`）：他的事项挂在别人
建的标准上时，那条标准（连同影响领域与阶段历史）一并带出，否则对方导入时外键落空，
还会撞上「事项必须关联标准」这类 CHECK 约束。

导入**不保留原 id**。两台机器各自从 1 开始编号，对方的标准 1 和本机的标准 1 是两回事；
早先的「保留 id + INSERT OR IGNORE」会让撞号的整行被静默忽略——报了「导入 N 条」，
界面上却什么也看不到（真正进去的只是几个新字典值）。现在的规则写在
`codes/api/transfer.py` 的 `IMPORT_PLAN` 里，每张表声明四件事：

| 声明 | 作用 |
| --- | --- |
| `fks` | 外键列 → 指向的表，按新旧 id 映射改写 |
| `required` | 这些外键映射不到时整行丢弃（NOT NULL，留着会破坏外键） |
| `natural` | 自然键：命中本机已有记录就沿用它的 id，子表跟着挂上去（合并） |
| `serial` | 业务编号列，本机已占用时 `db.next_serial()` 重新取号 |
| `keyless` | 复合主键的关联表，直接 `INSERT OR IGNORE` |

表按父在前的顺序处理，所以子表总能查到映射。单行违反约束只丢这一行并记下原因，
不连累整批；`OWNER_COLUMNS`（`created_by` / `updated_by` / `recorded_by` / `archived_by`）
里原本非空的值统一改写成确认的操作人，为空的保持为空。
草案版本命中本机已有记录且已有章节时，导入包的章节批次、章节与草案批注跳过并计入结果；
本机无章节时只导入来源草案的当前批次及其批注，避免留下隐藏的旧章节批次。
**导入必须带 `as_user`**——先 `POST /inspect` 让用户确认登记人，这一步同时解决了
同一个人中英文两种写法被拆成两个操作人的问题。

## 6. 前端约定

无构建步骤，脚本按 `core.js → grouped-list.js → fields.js → forms.js → action-form.js → records.js → pages/*.js` 顺序引入。
总览页额外引入 `charts.js`（横向细柱状图用 HTML + CSS，环形图用 SVG；项目的离线依赖里
没有图表库）、`pages/lifecycle.js`（生命周期视图）与专属样式 `css/dashboard.css`；
标签切换使用 Bootstrap Tab，`pages/dashboard.js` 负责把 `tab` / `std` 写入网址。

- **`Forms.buildForm`** 用字段声明数组生成表单，支持 `section` / `auto` / `textarea` /
  `date` / `fixed` / `choices` / `lookup` / `standard` / `draft` / `meeting` 等类型。
  加字段基本上就是往声明数组里加一行。
- **`auto` 字段默认不回传**（它没有控件，值由系统给出）。若这个字段在当前表单里
  只是不让改、后端却仍当必填项，声明里要加 `submit: true`，`read()` 会按传入值
  一并提交。事项的 `item_type` 就属于这种：从「新建 xx 事项」或会议行内派生进来时
  类型已定死、只作展示，漏提交会被后端判为「Item Type 取值不合法」。
- **`Forms.statusModal`** 是 §6 在前端的统一实现，上半只读历史、下半新增，四处复用。
- **`Fields.*`** 提供各类下拉的数据源，选项里冗余展示阶段、TC/WG、负责人、草案数等，
  避免用户为了确认选对了还要跳去另一个页面。
- **`Fields.standard`** 在下拉框底部固定提供快速建档入口；`Fields.quickCreateStandard`
  负责建档并自动回选。
- **`Stages.*`（stage-manager.js）** 是阶段管理的唯一前端实现：`timelineHtml` 画出
  九段可点击时间轴，`openForm` 是「推进 / 补录阶段」入口（选当前阶段之前的阶段即切到
  补录模式并在弹窗顶部给出审计提示），`openDetail` 是点某一段后的详情——可补录的给
  「补录该阶段」，已填写的记录一律给「修改」，详情与列表都展示创建 / 最近修改两个时间。
  已填写的阶段在下拉里灰显，
  后端仍负责最终校验。
- **`Records.*`（records.js）** 是五类记录明细与表单的唯一实现，全站共用。
  `Records.open(kind, id, ctx)` 按白名单在当前弹窗之上叠一层：标准可向下打开四类记录，
  草案可打开意见，会议可打开事项，事项可打开生成意见；子记录里的来源字段只读展示。
  `ctx.trail` 生成面包屑与「返回」按钮的悬浮提示，`ctx.onChanged` 把改动逐层回传给上级弹窗和列表页。
  记录栈以 `kind:id` 去重，最多四层；目标已在栈内时直接退回已有层。
- **弹窗不得改变页面布局**。Bootstrap 开弹窗时会给 `body` 补 `padding-right` 并把
  `overflow` 改成 `hidden`；本站滚动条由 `html` 常驻（`overflow-y: scroll` +
  `scrollbar-gutter: stable`）不会消失，那段补偿反而让内容区左右各跳一次。
  `app.css` 里的 `body.modal-open` 把这两处副作用还原，背景滚动改由 `core.js` 的
  `lockBackgroundScroll()` 给 `html` 挂 `modal-lock` 类来锁。左侧导航 `.rail` 用
  `position: fixed`（`.main` 以 `margin-left: var(--rail-w)` 让位）：原来的 `sticky`
  会在 `body` 变成滚动容器时失去参照物，页面滚到一半开弹窗，导航就会跟着内容跑掉。
- **沉浸查看不用浏览器全屏 API**。`requestFullscreen()` 期间浏览器只绘制全屏元素及其
  子节点，而弹窗和遮罩都挂在 `body` 下的 `#modal-host` 里，于是点开卡片什么也看不到。
  改成给面板加 `.is-immersive`（`position: fixed; inset: 0; z-index: 1040`），
  弹窗（1055）照常盖在上面，Esc 退出。
- **压缩下拉框内边距时要给箭头留位置**。原生 `.form-select` 和 Tom Select 的单选控件
  都是用右侧背景图画的箭头，把 `padding` 写成 `3px 8px` 这种两值写法会把右内边距一起
  压掉，长选项直接压在箭头上。列表筛选条、总览筛选器、Tom Select 各有一条专门留位置的
  规则，改样式时别顺手覆盖掉。
- **`App.openModal`（core.js）** 在第一层弹窗打开时只写入一个同页 history 保护项，不为每层
  分别写历史。弹窗存在期间浏览器后退会恢复保护项并保持弹窗不变；最后一层由界面关闭后，
  保护项自动退掉，浏览器后退恢复正常。返回、取消和点击背景只关闭当前层；弹窗不显示
  右上角关闭按钮，Esc 被禁用。`close()` 返回 Promise，保存后需要打开下一层时应先
  `await close()`，避免保护项同步竞态。
- 编辑表单必须叠在原详情上，不要先关闭详情；保存通过详情的 `refresh` 回调更新原层，
  取消则直接露出未变化的详情。
- 页面脚本只负责过滤条、列表与分页；新建按钮调用 `Records.*Form`，
  行点击调用 `Records.open`。
- **`GroupedList.create`（grouped-list.js）** 统一生成标准标题行并维护展开状态。
  初次进入和筛选变化后全部展开；普通刷新保留当前收起状态；组标题是原生按钮，支持键盘操作
  和 `aria-expanded`。列表分页必须继续使用后端返回的标准组，不能在前端对记录页临时分组。
- `?id=` 深链仍保留，用于收藏或外部链接直达某条记录的明细。

## 7. 测试

```bash
python -m unittest discover -s codes -p "test_api.py" -v
```

56 条用例覆盖 5 个主入口的增删改查、子表、必填与固定值校验、编号连续性、
阶段推进与历史补录、阶段记录的可改与时间戳留痕、字典字段首次录入自动新增、
归档与恢复、状态历史的上一值记录、会议派生事项、
反馈对象生成意见、五类事项建档与类型缺失报错、上达渠道固定值、
粘贴文本的清洗、总览两块清单的按人与按时间筛选、数据包的自包含导出与重新编号导入、
会议涉及标准的批注与取消挂载确认、请求头编码往返，
以及若干前端契约（弹窗层级、只读字段的 `submit`、导航固定与滚动锁）。
用临时库跑，不碰 `data/regtrack-v0.19.db`。

启动装配检查（在 Node 里用极简 DOM 桩跑一遍 `core.js` 的 `boot()`，
验证请求头、`/api/meta`、`/api/lookups`、操作人下拉都正常；
另外用同一套桩装配一遍事项表单，确认类型锁定时 `item_type` 仍会提交，
走一次阶段记录的修改确认创建时间不被改写，
再跑一遍总览两块清单的默认值与筛选、粘贴文本的清洗，
以及「导出 → 预检 → 确认登记人 → 导入」这条完整链路）：

```bash
python codes/run.py --port 5099 --no-browser    # 另开一个窗口
node ../boot_check.mjs 5099
```

`tests/browser_check.mjs` 是可选的完整页面渲染检查，需要本机装 Playwright，
不装不影响上面两项。

### 关于「当前操作人」请求头

HTTP 头只允许 ISO-8859-1，中文姓名直接放进 `X-User` 会让浏览器的 `fetch` 直接抛错
（`String contains non ISO-8859-1 code point`），整个页面卡在初始化。
因此 `core.js` 发请求前对姓名做 `encodeURIComponent`，
`codes/common.py` 的 `current_user()` 用 `unquote` 解回来。
**以后新增任何自定义请求头，含中文就必须同样编码。**

## 8. 常见改动

| 想做什么 | 改哪里 |
| --- | --- |
| 加一个固定值选项 | `codes/constants.py` + `sql/schema.sql` 的 CHECK，重建库 |
| 加一个开放列表选项 | 页面上的「字典维护」，不用改代码 |
| 给某个 Form 加字段 | `sql/schema.sql` 加列 → 对应 `codes/api/*.py` 的 `FIELDS` 白名单 → 页面脚本的字段声明 |
| 加一个受管状态字段 | 建专用历史表 + `codes/status.py` 的 `_TARGETS` + `constants.STATUS_FIELDS` |
| 加 / 改一个生命周期阶段 | `codes/constants.py` 的 `STAGES` + `sql/schema.sql` 两处 CHECK，重建库；前端无需改动 |
| 改主题配色 | `static/css/app.css` 顶部的 CSS 变量 |
| 换编号规则 | `codes/db.py` 的 `next_serial` |
