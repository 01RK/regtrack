"""固定取值（文档中标注为「固定值」的字段）。

这里是全系统唯一定义源：
- 业务接口写入前校验；
- 数据交换包导入时按 FIXED_VALUES 逐行校验；
- 通过 /api/meta 下发给前端渲染下拉框。
"""

# 程序版本：页面左下角显示，并作为静态资源的缓存版本号。
APP_VERSION = "v24-cloud.1"
# 表结构版本：写在数据库 app_meta 表中。只有 schema.sql 变化时才加 1；
# 程序启动时比对，不一致则拒绝打开，防止新旧程序混用同一份共享数据库。
SCHEMA_VERSION = 9

# --------------------------------------------------------------------- #
# 标准生命周期阶段
#
# 阶段在系统内部一律使用固定编码存取（standard.stage_code、
# standard_stage_history.stage_code），显示名称只在下发给前端时附带。
# 名称调整、多语言与流程扩展都只改这张表，不触碰任何业务数据。
# --------------------------------------------------------------------- #
STAGES = [
    {"code": "PRE_RESEARCH", "cn": "预研", "en": "Pre-research",
     "note": "标准制定第 1 阶段 · 立项前的技术预研"},
    {"code": "PROJECT_APPROVAL", "cn": "立项", "en": "Project Approval",
     "note": "标准制定第 2 阶段 · 计划下达"},
    {"code": "DRAFTING", "cn": "起草", "en": "Drafting",
     "note": "标准制定第 3 阶段 · 工作组草案"},
    {"code": "COMMENT_DRAFT", "cn": "征求意见", "en": "Draft for Comments",
     "note": "标准制定第 4 阶段 · 公开征求意见"},
    {"code": "REVIEW_DRAFT", "cn": "审查", "en": "Draft for Review",
     "note": "标准制定第 5 阶段 · 分标委审查"},
    {"code": "APPROVAL_DRAFT", "cn": "报批", "en": "Draft for Approval",
     "note": "标准制定第 6 阶段 · 报批待发布"},
    {"code": "RELEASED", "cn": "发布", "en": "Released",
     "note": "标准制定第 7 阶段 · 公告发布"},
    {"code": "IMPLEMENTED", "cn": "实施", "en": "In Force",
     "note": "标准制定第 8 阶段 · 正式实施"},
    {"code": "REEXAMINATION", "cn": "复审", "en": "Reexamination",
     "note": "标准制定第 9 阶段 · 定期复审"},
    {"code": "ABOLISHED", "cn": "废止", "en": "Abolished",
     "note": "标准制定第 10 阶段 · 作废或被代替"},
]

STAGE_CODES = [s["code"] for s in STAGES]
MEETING_STAGE_CODES = {s["cn"]: s["code"] for s in STAGES if s["code"] != "IMPLEMENTED"}
STAGE_ORDER = {code: index for index, code in enumerate(STAGE_CODES)}
STAGE_LABELS = {s["code"]: s["cn"] for s in STAGES}
FIRST_STAGE = STAGE_CODES[0]

# 终止性阶段：尚未发生时不作为「未来阶段」出现在生命周期时间轴上。
TERMINAL_STAGE = "ABOLISHED"

# 阶段历史的记录类型：正常向后推进，或补录当前阶段之前尚未填写的阶段。
STAGE_ADVANCE = "ADVANCE"
STAGE_BACKFILL = "BACKFILL"
STAGE_RECORD_TYPES = {
    STAGE_ADVANCE: "正常推进",
    STAGE_BACKFILL: "历史补录",
}
BACKFILL_WARNING = "⚠您正在补充更早阶段信息，请注意外部审计规范性"

STANDARD_TYPES = ["GB", "GB/T", "行业标准", "团体标准", "地方标准", "其他"]

RISK_LEVELS = ["High", "Medium", "Low", "TBD"]

OVERALL_IMPACTS = ["High", "Medium", "Low", "No Impact", "TBD"]

YES_NO_TBD = ["Yes", "No", "TBD"]

MEETING_TYPES = ["WG 全体会", "专题组会", "电话会", "宣贯会", "内部例会", "函审", "其他"]

COMMENT_STATUSES = [
    "Draft", "Submitted", "Accepted", "Partially Accepted",
    "Rejected", "Pending", "Withdrawn",
]

COMMENT_SOURCES = {"single": "Single-draft annotation", "comparison": "Draft comparison annotation"}

# 批注 / 意见类型。Others 用于类型未知的导入内容（草案原文 Initial_Comment、意见交换文件）。
ANNOTATION_TYPES = ["Interpretation", "Proposed Change", "Question", "Recommendation", "Others"]
IMPORTED_ANNOTATION_TYPE = "Others"

# Hover note next to every "Follow-up required" checkbox (Draft vs Submitted opinion).
FOLLOW_UP_HINT = {
    "zh": "勾选将默认显示在意见矩阵界面，便于后续进行追踪；未勾选则仅作为草稿，如一般解读或其他备注信息",
    "en": "Ticked opinions appear in the Comment Matrix by default for tracking. Unticked ones stay as drafts, such as general interpretations or other notes.",
}

# 草案版本名称只能从下列固定值中选择；映射值为该版本通常对应的阶段编码，
# 生命周期回顾据此归档草案，映射为 None 或该阶段未经历时按草案日期归档。
VERSION_STAGES = {
    "立项草案": "PROJECT_APPROVAL",
    "讨论稿": "DRAFTING",
    "征求意见稿": "COMMENT_DRAFT",
    "送审稿": "REVIEW_DRAFT",
    "报批稿": "APPROVAL_DRAFT",
    "发布稿": "RELEASED",
    "修改单": None,
}

VERSION_NAMES = list(VERSION_STAGES)

SUBMISSION_CHANNELS = ["邮件", "系统平台", "会议", "函件"]

ACTION_TYPES = [
    "Survey Feedback", "Collect Comments", "Lobby with Drafter",
    "Compliance Check", "Others",
]

ACTION_STATUSES = [
    "Open", "In Progress", "Waiting for Response", "Ready for Review",
    "Completed", "Closed", "On Hold", "Cancelled",
]

ACTION_OPEN_STATUSES = [
    s for s in ACTION_STATUSES if s not in ("Completed", "Closed", "Cancelled")
]

PRIORITIES = ["High", "Medium", "Low"]

LOBBY_METHODS = ["电话", "邮件", "会议", "其他"]

CHECK_RESULTS = ["Compliant", "Non-compliant", "Partial", "TBD"]

RESPONSE_STATUSES = ["Open", "Responded", "No Comment", "N-A"]

# 字典表 lookup_value 支持的类别 -> 中文名（后台维护页用）
LOOKUP_CATEGORIES = {
    "impact_area": "影响领域",
    "person": "人员",
    "team": "团队 / 部门",
    "organization": "机构 / 单位",
    "tc_wg": "TC / WG",
}

# 标准主档的字典型字段：字段名 -> 字典类别。
# 录入不存在的值时直接新增字典项并关联到当前标准，不阻断保存。
STANDARD_LOOKUP_FIELDS = {
    "tc_wg": "tc_wg",
    "responsible_authority": "organization",
    "leading_org": "organization",
    "mb_owner": "person",
}

# Action Item 子类型的追加必填字段：type -> [(field, 中文名), ...]
ACTION_REQUIRED_BY_TYPE = {
    "Survey Feedback": [
        ("requesting_body", "Requesting Body"),
        ("submission_due_date", "Submission Due Date"),
    ],
    "Lobby with Drafter": [
        ("drafter_counterpart", "Drafter / Counterpart"),
        ("target_position", "Target Position"),
    ],
    "Compliance Check": [
        ("check_owner", "Responsible Person / Team"),
        ("check_due_date", "Due Date"),
    ],
    "Others": [
        ("coordinator", "Coordinator"),
    ],
    "Collect Comments": [],
}

# 通用状态机制（§6）：实体 -> (状态字段名, 取值集合, 中文标题)
STATUS_FIELDS = {
    ("comment", "status"): (COMMENT_STATUSES, "Comment Status History 意见状态历史"),
    ("action_item", "current_status"): (ACTION_STATUSES, "事项状态历史"),
    ("feedback_recipient", "response_status"): (RESPONSE_STATUSES, "回复状态历史"),
}

# 各表固定值字段的取值范围（None 表示允许为空）。数据交换包绕过业务表单直接写表，按此逐行校验。
_STAGE_CODES = [s["code"] for s in STAGES]
FIXED_VALUES = {
    "lookup_value": {"category": list(LOOKUP_CATEGORIES), "is_active": [0, 1]},
    "standard": {"stage_code": _STAGE_CODES, "std_type": STANDARD_TYPES + [None],
                 "risk_level": RISK_LEVELS + [None]},
    "standard_stage_history": {"stage_code": _STAGE_CODES, "record_type": list(STAGE_RECORD_TYPES),
                               "is_manual": [0, 1]},
    "draft": {"version_name": VERSION_NAMES, "overall_impact": OVERALL_IMPACTS + [None]},
    "draft_annotation": {"annotation_type": ANNOTATION_TYPES},
    "meeting": {"meeting_type": MEETING_TYPES + [None]},
    "meeting_standard": {"imported_stage_code": _STAGE_CODES + [None]},
    "action_item": {"item_type": ACTION_TYPES, "priority": PRIORITIES + [None],
                    "current_status": ACTION_STATUSES,
                    "submission_channel": SUBMISSION_CHANNELS + [None],
                    "lobby_method": LOBBY_METHODS + [None], "check_result": CHECK_RESULTS + [None]},
    "action_status_history": {"previous_value": ACTION_STATUSES + [None], "new_value": ACTION_STATUSES},
    "feedback_recipient": {"response_status": RESPONSE_STATUSES},
    "recipient_status_history": {"previous_value": RESPONSE_STATUSES + [None],
                                 "new_value": RESPONSE_STATUSES},
    "comment": {"needs_follow_up": [0, 1]},
    "comment_status_history": {"previous_value": COMMENT_STATUSES + [None], "new_value": COMMENT_STATUSES},
}


def meta_payload() -> dict:
    """下发给前端的全部固定取值。"""
    return {
        "stages": [{"code": s["code"], "label": s["cn"], "en": s["en"],
                    "note": s["note"], "order": index}
                   for index, s in enumerate(STAGES)],
        "stage_record_types": STAGE_RECORD_TYPES,
        "backfill_warning": BACKFILL_WARNING,
        "terminal_stage": TERMINAL_STAGE,
        "standard_types": STANDARD_TYPES,
        "risk_levels": RISK_LEVELS,
        "overall_impacts": OVERALL_IMPACTS,
        "version_names": VERSION_NAMES,
        "yes_no_tbd": YES_NO_TBD,
        "meeting_types": MEETING_TYPES,
        "comment_statuses": COMMENT_STATUSES,
        "annotation_types": ANNOTATION_TYPES,
        "follow_up_hint": FOLLOW_UP_HINT,
        "comment_sources": COMMENT_SOURCES,
        "submission_channels": SUBMISSION_CHANNELS,
        "action_types": ACTION_TYPES,
        "action_statuses": ACTION_STATUSES,
        "action_open_statuses": ACTION_OPEN_STATUSES,
        "priorities": PRIORITIES,
        "lobby_methods": LOBBY_METHODS,
        "check_results": CHECK_RESULTS,
        "response_statuses": RESPONSE_STATUSES,
        "lookup_categories": LOOKUP_CATEGORIES,
        "action_required_by_type": {
            k: [f for f, _ in v] for k, v in ACTION_REQUIRED_BY_TYPE.items()
        },
    }
