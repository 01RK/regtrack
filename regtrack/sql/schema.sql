-- =====================================================================
-- 法规跟踪系统 (Regulation Tracking System) — SQLite schema
-- 对应《法规跟踪系统 Forms 与 Subforms 设计说明》
--
-- 设计要点
--   1. 5 个主入口 -> standard / draft / meeting / comment / action_item
--   2. 文档 §6「通用状态机制」-> 四张历史表分别以真实外键关联业务表
--      阶段/状态历史（Stage History、Comment Status History、
--      Action Item 状态、Feedback Recipient 回复状态）。
--   3. 「固定值」字段用 CHECK 约束在库层兜底，Python constants.py 为唯一定义源。
--   4. 「可维护」的开放列表（影响领域 / 人员 / 团队 / 机构 / TC-WG）
--      统一放在 lookup_value 字典表；业务录入的新值由后端即时补写，
--      用户无需先维护字典。
--   6. 标准阶段一律用固定编码存取（stage_code），显示名称由前端按语言环境渲染。
--   7. 标准不做物理删除：archived_at 置位即归档，全部历史数据继续保留。
--   5. 日期一律 TEXT，ISO 格式 'YYYY-MM-DD'；时间戳 'YYYY-MM-DD HH:MM:SS'。
-- =====================================================================

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------
-- 0. 字典表（可维护的开放列表）
-- ---------------------------------------------------------------------
CREATE TABLE lookup_value (
    id          INTEGER PRIMARY KEY,
    category    TEXT    NOT NULL,          -- impact_area | person | team | organization | tc_wg
    value       TEXT    NOT NULL,          -- 下拉框中真正写入业务表的值
    note        TEXT,                      -- 冗余显示用（部门、说明），便于人工识别
    sort_order  INTEGER NOT NULL DEFAULT 100,
    is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    UNIQUE (category, value)
);
CREATE INDEX ix_lookup_category ON lookup_value (category, is_active, sort_order);

-- ---------------------------------------------------------------------
-- 1. Standard Profile 标准主档
-- ---------------------------------------------------------------------
CREATE TABLE standard (
    id                    INTEGER PRIMARY KEY,
    std_no                TEXT NOT NULL UNIQUE,          -- 标准编号，唯一身份
    name_cn               TEXT NOT NULL,
    name_en               TEXT,
    -- 当前阶段：由 standard_stage_history 计算得出，不允许直接编辑
    stage_code            TEXT NOT NULL
        CHECK (stage_code IN ('PRE_RESEARCH', 'PROJECT_APPROVAL', 'DRAFTING',
                              'COMMENT_DRAFT', 'REVIEW_DRAFT', 'APPROVAL_DRAFT',
                              'RELEASED', 'IMPLEMENTED', 'ABOLISHED')),
    std_type              TEXT
        CHECK (std_type IS NULL OR std_type IN ('GB', 'GB/T', '行业标准',
                                                '团体标准', '地方标准', '其他')),
    tc_wg                 TEXT,
    responsible_authority TEXT,
    leading_org           TEXT,
    risk_level            TEXT
        CHECK (risk_level IS NULL OR risk_level IN ('High', 'Medium', 'Low', 'TBD')),
    mb_owner              TEXT,
    planned_release_date  TEXT,
    actual_release_date   TEXT,
    effective_date        TEXT,
    scope                 TEXT,
    -- 归档（取代物理删除）：置位后不在正常列表出现，数据全部保留
    archived_at           TEXT,
    archived_by           TEXT,
    created_at            TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    created_by            TEXT,
    updated_at            TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_by            TEXT
);
CREATE INDEX ix_standard_stage ON standard (stage_code);
CREATE INDEX ix_standard_archived ON standard (archived_at);
CREATE INDEX ix_standard_name ON standard (name_cn);

-- Main Impact Area 多选
CREATE TABLE standard_impact_area (
    standard_id INTEGER NOT NULL REFERENCES standard (id) ON DELETE CASCADE,
    impact_area TEXT    NOT NULL,
    PRIMARY KEY (standard_id, impact_area)
);

-- ---------------------------------------------------------------------
-- 2. Standard Stage History 标准阶段历史
--    每个标准的每个阶段至多一条记录（UNIQUE 约束保证不重复填写）。
--    record_type 区分阶段记录的来源：
--      ADVANCE  正常推进——按生命周期顺序进入下一个阶段；
--      BACKFILL 历史补录——补充当前阶段之前尚未填写的阶段，
--               可填真实发生时间，不受当前阶段时间顺序限制。
--    ◆ 记录写入后不锁定：两类记录的日期、依据、说明都允许更正，
--      审计追溯改由 created_at / created_by（首次记录）与
--      updated_at / updated_by（最近一次修改）四个字段承担，界面同时展示。
--      阶段本身（stage_code）不可改写——换阶段等于另一条记录。
-- ---------------------------------------------------------------------
CREATE TABLE standard_stage_history (
    id             INTEGER PRIMARY KEY,
    standard_id    INTEGER NOT NULL REFERENCES standard (id) ON DELETE CASCADE,
    stage_code     TEXT NOT NULL
        CHECK (stage_code IN ('PRE_RESEARCH', 'PROJECT_APPROVAL', 'DRAFTING',
                              'COMMENT_DRAFT', 'REVIEW_DRAFT', 'APPROVAL_DRAFT',
                              'RELEASED', 'IMPLEMENTED', 'ABOLISHED')),
    record_type    TEXT NOT NULL CHECK (record_type IN ('ADVANCE', 'BACKFILL')),
    effective_date TEXT NOT NULL,
    note           TEXT,
    reference      TEXT,               -- Supporting Reference（URL / 路径）
    created_at     TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),  -- 系统自动
    created_by     TEXT NOT NULL,                                         -- 系统自动
    updated_at     TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),  -- 系统自动
    -- 系统自动；为 NULL 表示这条记录还没有人改过（此时 updated_at 与创建时间一致）
    updated_by     TEXT,
    UNIQUE (standard_id, stage_code)
);
CREATE INDEX ix_standard_stage_history_parent
    ON standard_stage_history (standard_id, effective_date DESC, id DESC);

-- ---------------------------------------------------------------------
-- 3. Draft Registry 草案登记
-- ---------------------------------------------------------------------
CREATE TABLE draft (
    id             INTEGER PRIMARY KEY,
    standard_id    INTEGER NOT NULL REFERENCES standard (id) ON DELETE CASCADE,
    version_name   TEXT NOT NULL
        CHECK (version_name IN ('立项草案', '讨论稿', '征求意见稿', '送审稿',
                                '报批稿', '发布稿', '修改单')),
    sub_version_no TEXT NOT NULL,      -- 1.0 / 2.0 ...
    draft_date     TEXT NOT NULL,
    file_link      TEXT,
    issued_by      TEXT,
    main_summary   TEXT,
    overall_impact TEXT
        CHECK (overall_impact IS NULL OR overall_impact IN ('High', 'Medium', 'Low',
                                                            'No Impact', 'TBD')),
    notes          TEXT,
    created_at     TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    created_by     TEXT,
    updated_at     TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_by     TEXT,
    UNIQUE (standard_id, version_name, sub_version_no)
);
CREATE INDEX ix_draft_standard ON draft (standard_id, draft_date DESC);
CREATE INDEX ix_draft_group_created
    ON draft (standard_id, created_at DESC, id DESC);

-- 保存当前导入正文；替换时先重绑沿用的批注，再删除旧批次及其他旧批注。
CREATE TABLE draft_import (
    id INTEGER PRIMARY KEY,
    draft_id INTEGER NOT NULL REFERENCES draft(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    source_version TEXT NOT NULL,
    source_standard_no TEXT NOT NULL,
    source_standard_name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    created_by TEXT NOT NULL,
    UNIQUE(id, draft_id)
);
CREATE INDEX ix_draft_import ON draft_import(draft_id, id DESC);
CREATE TABLE draft_chapter (
    id INTEGER PRIMARY KEY,
    draft_id INTEGER NOT NULL REFERENCES draft(id) ON DELETE CASCADE,
    import_batch_id INTEGER NOT NULL,
    clause_no TEXT NOT NULL, parent_clause_no TEXT NOT NULL,
    level INTEGER NOT NULL, sequence INTEGER NOT NULL,
    title_cn TEXT, content_cn TEXT, title_en TEXT, content_en TEXT, illustration TEXT,
    clause_type TEXT, source_page TEXT,
    review_status TEXT, confidence TEXT, needs_review TEXT, import_key TEXT NOT NULL,
    UNIQUE(import_batch_id, clause_no), UNIQUE(import_batch_id, sequence),
    UNIQUE(import_batch_id, import_key), UNIQUE(id, draft_id),
    FOREIGN KEY (import_batch_id, draft_id) REFERENCES draft_import(id, draft_id) ON DELETE CASCADE
);
CREATE INDEX ix_draft_chapter ON draft_chapter(draft_id, import_batch_id);
CREATE TABLE draft_chapter_image (
    id INTEGER PRIMARY KEY,
    draft_id INTEGER NOT NULL,
    chapter_id INTEGER NOT NULL,
    position INTEGER NOT NULL,
    mime_type TEXT NOT NULL,
    data_base64 TEXT NOT NULL,
    UNIQUE(chapter_id, position),
    FOREIGN KEY (chapter_id, draft_id) REFERENCES draft_chapter(id, draft_id) ON DELETE CASCADE
);
CREATE INDEX ix_draft_chapter_image ON draft_chapter_image(chapter_id, position);
CREATE TABLE draft_annotation (
    id INTEGER PRIMARY KEY,
    draft_id INTEGER NOT NULL REFERENCES draft(id) ON DELETE CASCADE,
    chapter_id INTEGER,
    annotation_type TEXT NOT NULL
        CHECK (annotation_type IN ('Interpretation', 'Comment', 'Question', 'Recommendation')),
    content TEXT NOT NULL,
    created_at TEXT NOT NULL,
    created_by TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    updated_by TEXT NOT NULL,
    FOREIGN KEY (chapter_id, draft_id) REFERENCES draft_chapter(id, draft_id) ON DELETE CASCADE
);
CREATE INDEX ix_draft_annotation ON draft_annotation(draft_id, chapter_id);
CREATE VIEW v_current_draft_chapter AS
SELECT c.* FROM draft_chapter c
WHERE c.import_batch_id = (SELECT MAX(i.id) FROM draft_import i WHERE i.draft_id = c.draft_id);

-- ---------------------------------------------------------------------
-- 4. WG Meeting 工作组会议
-- ---------------------------------------------------------------------
CREATE TABLE meeting (
    id                 INTEGER PRIMARY KEY,
    meeting_no         TEXT NOT NULL UNIQUE,   -- 系统自动 MTG-YYYY-NNN
    title              TEXT NOT NULL,
    meeting_date       TEXT NOT NULL,
    meeting_type       TEXT
        CHECK (meeting_type IS NULL OR meeting_type IN ('WG 全体会', '专题组会',
                                                        '电话会', '宣贯会', '内部例会',
                                                        '函审', '其他')),
    organizer          TEXT,
    participants       TEXT,
    key_discussions    TEXT,
    overall_conclusion TEXT,
    material_link      TEXT,
    next_meeting_date  TEXT,
    created_at         TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    created_by         TEXT,
    updated_at         TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_by         TEXT
);
CREATE INDEX ix_meeting_date ON meeting (meeting_date DESC);

-- ◆ 会议与标准为多对多关系：
--    · 一场会议可以同时讨论多个标准（如内部例会逐项过台账），也允许暂未挂标准；
--    · 一个标准可以出现在多场会议中；
--    · 同一场会议对同一标准只挂一次，note 记录该标准在本次会议中的讨论要点。
CREATE TABLE meeting_standard (
    meeting_id  INTEGER NOT NULL REFERENCES meeting (id) ON DELETE CASCADE,
    standard_id INTEGER NOT NULL REFERENCES standard (id) ON DELETE CASCADE,
    note        TEXT,
    PRIMARY KEY (meeting_id, standard_id)
);
-- 从标准侧反查会议（标准明细的「会议」页签、生命周期回顾）
CREATE INDEX ix_meeting_standard_standard ON meeting_standard (standard_id, meeting_id);

-- ---------------------------------------------------------------------
-- 5. Action Item 事项（4 类核心 + Others）
--    子类型字段列在同一张表，按 item_type 决定显示与必填。
-- ---------------------------------------------------------------------
CREATE TABLE action_item (
    id                  INTEGER PRIMARY KEY,
    item_no             TEXT NOT NULL UNIQUE,   -- 系统自动 AI-YYYY-NNN
    item_type           TEXT NOT NULL
        CHECK (item_type IN ('Survey Feedback', 'Collect Comments',
                             'Lobby with Drafter', 'Compliance Check', 'Others')),
    standard_id         INTEGER REFERENCES standard (id) ON DELETE SET NULL,
    meeting_id          INTEGER REFERENCES meeting (id) ON DELETE SET NULL,
    draft_id            INTEGER REFERENCES draft (id) ON DELETE SET NULL,
    title               TEXT NOT NULL,
    description         TEXT NOT NULL,
    related_clause      TEXT,
    priority            TEXT
        CHECK (priority IS NULL OR priority IN ('High', 'Medium', 'Low')),
    current_status      TEXT NOT NULL
        CHECK (current_status IN ('Open', 'In Progress', 'Waiting for Response',
                                  'Ready for Review', 'Completed', 'Closed',
                                  'On Hold', 'Cancelled')),
    final_summary       TEXT,
    supporting_ref      TEXT,
    -- ① Survey Feedback
    requesting_body     TEXT,
    submission_due_date TEXT,
    -- 上达渠道是固定值，不走字典表
    submission_channel  TEXT
        CHECK (submission_channel IS NULL
               OR submission_channel IN ('邮件', '系统平台', '会议', '函件')),
    -- ③ Lobby with Drafter
    drafter_counterpart TEXT,
    target_position     TEXT,
    actual_lobby_time   TEXT,
    lobby_method        TEXT
        CHECK (lobby_method IS NULL OR lobby_method IN ('电话', '邮件', '会议', '其他')),
    outcome             TEXT,
    -- ④ Compliance Check
    check_owner         TEXT,
    check_due_date      TEXT,
    actual_check_time   TEXT,
    check_result        TEXT
        CHECK (check_result IS NULL OR check_result IN ('Compliant', 'Non-compliant',
                                                        'Partial', 'TBD')),
    gap_description     TEXT,
    -- ⑤ Others
    coordinator         TEXT,
    target_date         TEXT,
    created_at          TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    created_by          TEXT,
    updated_at          TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_by          TEXT,
    -- 顶层必填：Related Standard √（Others 可空）
    CHECK (item_type = 'Others' OR standard_id IS NOT NULL)
);
CREATE INDEX ix_action_standard ON action_item (standard_id);
CREATE INDEX ix_action_group_created
    ON action_item (standard_id, created_at DESC, id DESC);
CREATE INDEX ix_action_meeting ON action_item (meeting_id);
CREATE INDEX ix_action_status ON action_item (current_status);

-- ◆ Subform · Action Status History 事项状态历史
CREATE TABLE action_status_history (
    id             INTEGER PRIMARY KEY,
    action_item_id INTEGER NOT NULL REFERENCES action_item (id) ON DELETE CASCADE,
    previous_value TEXT
        CHECK (previous_value IS NULL OR previous_value IN
               ('Open', 'In Progress', 'Waiting for Response', 'Ready for Review',
                'Completed', 'Closed', 'On Hold', 'Cancelled')),
    new_value      TEXT NOT NULL
        CHECK (new_value IN
               ('Open', 'In Progress', 'Waiting for Response', 'Ready for Review',
                'Completed', 'Closed', 'On Hold', 'Cancelled')),
    effective_date TEXT NOT NULL,
    note           TEXT,
    reference      TEXT,
    recorded_at    TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    recorded_by    TEXT NOT NULL
);
CREATE INDEX ix_action_status_history_parent
    ON action_status_history (action_item_id, effective_date DESC, id DESC);

-- ◆ Subform · Feedback Recipients 反馈对象（仅 Collect Comments）
CREATE TABLE feedback_recipient (
    id                  INTEGER PRIMARY KEY,
    action_item_id      INTEGER NOT NULL REFERENCES action_item (id) ON DELETE CASCADE,
    respondent_team     TEXT,
    respondent_person   TEXT,
    response_status     TEXT NOT NULL
        CHECK (response_status IN ('Open', 'Responded', 'No Comment', 'N-A')),
    response_due_date   TEXT,
    response_actual_date TEXT,
    response_summary    TEXT,
    created_at          TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    created_by          TEXT,
    -- Team / Person 二选一必填
    CHECK (COALESCE(respondent_team, '') <> '' OR COALESCE(respondent_person, '') <> '')
);
CREATE INDEX ix_recipient_action ON feedback_recipient (action_item_id);

-- ◆ Subform · Recipient Status History 反馈对象回复状态历史
CREATE TABLE recipient_status_history (
    id                    INTEGER PRIMARY KEY,
    feedback_recipient_id INTEGER NOT NULL REFERENCES feedback_recipient (id) ON DELETE CASCADE,
    previous_value        TEXT
        CHECK (previous_value IS NULL OR previous_value IN
               ('Open', 'Responded', 'No Comment', 'N-A')),
    new_value             TEXT NOT NULL
        CHECK (new_value IN ('Open', 'Responded', 'No Comment', 'N-A')),
    effective_date        TEXT NOT NULL,
    note                  TEXT,
    reference             TEXT,
    recorded_at           TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    recorded_by           TEXT NOT NULL
);
CREATE INDEX ix_recipient_status_history_parent
    ON recipient_status_history (feedback_recipient_id, effective_date DESC, id DESC);

-- ---------------------------------------------------------------------
-- 6. Comment Matrix 意见矩阵
-- ---------------------------------------------------------------------
CREATE TABLE comment (
    id                  INTEGER PRIMARY KEY,
    comment_no          TEXT NOT NULL UNIQUE,   -- 系统自动 CM-YYYY-NNN
    standard_id         INTEGER NOT NULL REFERENCES standard (id) ON DELETE CASCADE,
    draft_id            INTEGER REFERENCES draft (id) ON DELETE SET NULL,
    clause_no           TEXT,
    topic               TEXT,
    comment_text        TEXT NOT NULL,
    rationale           TEXT NOT NULL,
    status              TEXT NOT NULL
        CHECK (status IN ('Draft', 'Submitted', 'Accepted', 'Partially Accepted',
                          'Rejected', 'Pending', 'Withdrawn')),
    submitted_by        TEXT NOT NULL,
    submission_channel  TEXT
        CHECK (submission_channel IS NULL
               OR submission_channel IN ('邮件', '系统平台', '会议', '函件')),
    submission_date     TEXT,
    response            TEXT,
    follow_up           TEXT,
    -- 由 Action Item「Collect Comments」的反馈对象一键生成时留痕
    source_recipient_id INTEGER REFERENCES feedback_recipient (id) ON DELETE SET NULL,
    created_at          TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    created_by          TEXT,
    updated_at          TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_by          TEXT
);
CREATE INDEX ix_comment_standard ON comment (standard_id);
CREATE INDEX ix_comment_group_created
    ON comment (standard_id, created_at DESC, id DESC);
CREATE INDEX ix_comment_status ON comment (status);

-- ◆ Subform · Comment Status History 意见状态历史
CREATE TABLE comment_status_history (
    id             INTEGER PRIMARY KEY,
    comment_id     INTEGER NOT NULL REFERENCES comment (id) ON DELETE CASCADE,
    previous_value TEXT
        CHECK (previous_value IS NULL OR previous_value IN
               ('Draft', 'Submitted', 'Accepted', 'Partially Accepted',
                'Rejected', 'Pending', 'Withdrawn')),
    new_value      TEXT NOT NULL
        CHECK (new_value IN
               ('Draft', 'Submitted', 'Accepted', 'Partially Accepted',
                'Rejected', 'Pending', 'Withdrawn')),
    effective_date TEXT NOT NULL,
    note           TEXT,
    reference      TEXT,
    recorded_at    TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    recorded_by    TEXT NOT NULL
);
CREATE INDEX ix_comment_status_history_parent
    ON comment_status_history (comment_id, effective_date DESC, id DESC);

-- ---------------------------------------------------------------------
-- 7. 列表视图：标准主档带关联计数（列表页与首页统计共用）
-- ---------------------------------------------------------------------
CREATE VIEW v_standard_overview AS
SELECT
    s.*,
    (SELECT COUNT(*) FROM draft d WHERE d.standard_id = s.id)                        AS draft_count,
    (SELECT COUNT(*) FROM comment c WHERE c.standard_id = s.id)                      AS comment_count,
    (SELECT COUNT(*) FROM action_item a
      WHERE a.standard_id = s.id
        AND a.current_status NOT IN ('Completed', 'Closed', 'Cancelled'))            AS open_action_count,
    (SELECT COUNT(*) FROM meeting_standard ms WHERE ms.standard_id = s.id)           AS meeting_count,
    (SELECT GROUP_CONCAT(sia.impact_area, ', ')
       FROM standard_impact_area sia WHERE sia.standard_id = s.id)                   AS impact_areas
FROM standard s;
