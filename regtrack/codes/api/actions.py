"""5. Action Item 事项（4 类核心 + Others）+ ◆ Subform · Feedback Recipients。"""

from flask import Blueprint, jsonify, request

import db
import grouped
import lookups_service
import status
from common import (
    ApiError, check_date, check_enum, clean, current_user, now,
    payload_of, require, stamp_create, stamp_update, today,
)
from constants import (
    ACTION_OPEN_STATUSES, ACTION_REQUIRED_BY_TYPE, ACTION_STATUSES, ACTION_TYPES,
    CHECK_RESULTS,
    LOBBY_METHODS, PRIORITIES, RESPONSE_STATUSES, SUBMISSION_CHANNELS,
)

bp = Blueprint("actions", __name__, url_prefix="/api/actions")

COMMON_FIELDS = ["item_type", "standard_id", "meeting_id", "draft_id", "title",
                 "description", "related_clause", "priority", "current_status",
                 "final_summary", "supporting_ref"]

TYPE_FIELDS = {
    "Survey Feedback": ["requesting_body", "submission_due_date", "submission_channel"],
    "Collect Comments": [],
    "Lobby with Drafter": ["drafter_counterpart", "target_position", "actual_lobby_time",
                           "lobby_method", "outcome"],
    "Compliance Check": ["check_owner", "check_due_date", "actual_check_time",
                         "check_result", "gap_description"],
    "Others": ["coordinator", "target_date"],
}

RECIPIENT_FIELDS = ["respondent_team", "respondent_person", "response_status",
                    "response_due_date", "response_actual_date", "response_summary"]

_SELECT = """
SELECT a.*, s.std_no, s.name_cn, s.stage_code,
       m.meeting_no, m.title AS meeting_title, m.meeting_date,
       d.version_name, d.sub_version_no,
       COALESCE(a.submission_due_date, a.check_due_date, a.target_date) AS due_date,
       (SELECT COUNT(*) FROM feedback_recipient r WHERE r.action_item_id = a.id)
           AS recipient_count,
       (SELECT COUNT(*) FROM feedback_recipient r
         WHERE r.action_item_id = a.id AND r.response_status = 'Responded')
           AS responded_count
  FROM action_item a
  LEFT JOIN standard s ON s.id = a.standard_id
  LEFT JOIN meeting m ON m.id = a.meeting_id
  LEFT JOIN draft d ON d.id = a.draft_id
"""


def _get(action_id: int) -> dict:
    row = db.query_one(_SELECT + " WHERE a.id = ?", (action_id,))
    if not row:
        raise ApiError("事项不存在", 404)
    return row


def _recipients(action_id: int) -> list[dict]:
    return db.query(
        """SELECT r.*, (SELECT c.comment_no FROM comment c
                         WHERE c.source_recipient_id = r.id LIMIT 1) AS generated_comment_no,
                  (SELECT c.id FROM comment c
                    WHERE c.source_recipient_id = r.id LIMIT 1) AS generated_comment_id
             FROM feedback_recipient r
            WHERE r.action_item_id = ? ORDER BY r.id""", (action_id,))


def _allowed_fields(item_type: str) -> list[str]:
    return COMMON_FIELDS + TYPE_FIELDS[item_type]


def _validate(data: dict) -> None:
    check_enum(data, "item_type", ACTION_TYPES, "Item Type", required=True)
    require(data, [("title", "Title"), ("description", "Description"),
                   ("current_status", "Current Status")])
    check_enum(data, "current_status", ACTION_STATUSES, "Current Status", required=True)
    check_enum(data, "priority", PRIORITIES, "Priority")

    item_type = data["item_type"]
    if item_type != "Others" and not data.get("standard_id"):
        raise ApiError("「Related Standard」为必填项（仅 Others 类可空）",
                       field="standard_id")
    if data.get("standard_id") and not db.query_one(
            "SELECT id FROM standard WHERE id = ?", (data["standard_id"],)):
        raise ApiError("所选标准不存在", field="standard_id")
    if data.get("draft_id"):
        d = db.query_one("SELECT standard_id FROM draft WHERE id = ?", (data["draft_id"],))
        if not d:
            raise ApiError("所选草案不存在", field="draft_id")
        if data.get("standard_id") and int(d["standard_id"]) != int(data["standard_id"]):
            raise ApiError("草案必须属于所选标准", field="draft_id")

    require(data, ACTION_REQUIRED_BY_TYPE[item_type])
    # 上达渠道是固定值，不走字典
    check_enum(data, "submission_channel", SUBMISSION_CHANNELS, "Submission Channel")
    check_enum(data, "lobby_method", LOBBY_METHODS, "Method")
    check_enum(data, "check_result", CHECK_RESULTS, "Check Result")
    for f, label in (("submission_due_date", "Submission Due Date"),
                     ("check_due_date", "Due Date"), ("target_date", "Target Date"),
                     ("actual_lobby_time", "Actual Lobby Time"),
                     ("actual_check_time", "Actual Check Time")):
        check_date(data, f, label)
    # Compliance Check 完成时必须给出核查结论
    if (item_type == "Compliance Check"
            and data.get("current_status") in ("Completed", "Closed")
            and not data.get("check_result")):
        raise ApiError("Compliance Check 事项在完成/关闭时必须填写「Check Result」",
                       field="check_result")


# --------------------------------------------------------------------- #
# 列表 / 明细
# --------------------------------------------------------------------- #
@bp.get("")
def list_actions():
    where, params = ["(a.standard_id IS NULL OR s.archived_at IS NULL)"], []
    q = (request.args.get("q") or "").strip()
    if q:
        where.append("(a.item_no LIKE ? OR a.title LIKE ? OR a.description LIKE ?"
                     " OR COALESCE(s.std_no,'') LIKE ? OR COALESCE(s.name_cn,'') LIKE ?)")
        params += [f"%{q}%"] * 5
    for field, arg in (("a.item_type", "type"), ("a.current_status", "status"),
                       ("a.priority", "priority"), ("a.standard_id", "standard_id"),
                       ("a.meeting_id", "meeting_id")):
        val = (request.args.get(arg) or "").strip()
        if val:
            where.append(f"{field} = ?")
            params.append(val)
    if request.args.get("open_only") == "1":
        marks = ", ".join("?" * len(ACTION_OPEN_STATUSES))
        where.append(f"a.current_status IN ({marks})")
        params += ACTION_OPEN_STATUSES

    clause = " WHERE " + " AND ".join(where)
    item_sql = f"""
        SELECT COALESCE(a.standard_id, 0) AS group_key, a.*,
               COALESCE(s.std_no, '未关联标准') AS std_no,
               COALESCE(s.name_cn, '仅 Others 类事项') AS name_cn,
               s.stage_code, m.meeting_no, m.title AS meeting_title, m.meeting_date,
               d.version_name, d.sub_version_no,
               COALESCE(a.submission_due_date, a.check_due_date, a.target_date) AS due_date,
               (SELECT COUNT(*) FROM feedback_recipient r WHERE r.action_item_id = a.id)
                   AS recipient_count,
               (SELECT COUNT(*) FROM feedback_recipient r
                 WHERE r.action_item_id = a.id AND r.response_status = 'Responded')
                   AS responded_count
          FROM action_item a
          LEFT JOIN standard s ON s.id = a.standard_id
          LEFT JOIN meeting m ON m.id = a.meeting_id
          LEFT JOIN draft d ON d.id = a.draft_id
          {clause}
    """

    def enrich(row):
        if row["item_type"] == "Collect Comments":
            row["recipients"] = _recipients(row["id"])

    return grouped.response(item_sql, params, enrich)


@bp.get("/<int:action_id>")
def detail(action_id):
    return jsonify(detail_payload(action_id))


def detail_payload(action_id: int) -> dict:
    row = _get(action_id)
    row["recipients"] = _recipients(action_id)
    row["status_history"] = status.history("action_item", action_id, "current_status")
    return row


@bp.post("")
def create():
    payload = payload_of(request)
    item_type = (payload.get("item_type") or "").strip()
    if item_type not in ACTION_TYPES:
        # 类型决定后面收哪些字段，必须先定下来才能 clean，所以在这里单独判一次。
        raise ApiError(f"「Item Type」取值不合法：{item_type or '空'}", field="item_type",
                       detail="可选值：" + "、".join(ACTION_TYPES))
    data = clean(payload, _allowed_fields(item_type))
    data["item_type"] = item_type
    data.setdefault("current_status", "Open")
    _validate(data)
    data["item_no"] = db.next_serial("action_item", "item_no", "AI", today()[:4])
    action_id = db.insert("action_item", stamp_update(stamp_create(data)))
    status.seed_initial("action_item", action_id, "current_status",
                        data["current_status"], today())

    for r in payload.get("recipients") or []:
        _insert_recipient(action_id, r)
    if item_type == "Collect Comments" and not _recipients(action_id):
        raise ApiError("Collect Comments 事项至少需要 1 个反馈对象", field="recipients")

    db.commit()
    return jsonify(detail_payload(action_id)), 201


@bp.put("/<int:action_id>")
def update(action_id):
    current = _get(action_id)
    payload = payload_of(request)
    item_type = current["item_type"]          # 类型建档后不再变更
    data = clean(payload, _allowed_fields(item_type))
    data.pop("item_type", None)
    data.pop("current_status", None)          # 状态只能通过状态历史推进
    _validate({**current, **data})
    db.update("action_item", action_id, stamp_update(data))
    db.commit()
    return jsonify(detail_payload(action_id))


@bp.delete("/<int:action_id>")
def remove(action_id):
    _get(action_id)
    db.delete("action_item", action_id)
    db.commit()
    return jsonify(ok=True)


# --------------------------------------------------------------------- #
# 状态历史
# --------------------------------------------------------------------- #
@bp.get("/<int:action_id>/status-history")
def status_history(action_id):
    _get(action_id)
    return jsonify(status.history("action_item", action_id, "current_status"))


@bp.post("/<int:action_id>/status-history")
def add_status(action_id):
    action = _get(action_id)
    payload = payload_of(request)
    if (action["item_type"] == "Compliance Check"
            and payload.get("new_value") in ("Completed", "Closed")
            and not action["check_result"]):
        raise ApiError("请先填写「Check Result」再把合规核查事项置为完成/关闭",
                       field="check_result")
    row = status.add("action_item", action_id, "current_status", payload)
    return jsonify(history=row, action=detail_payload(action_id)), 201


# --------------------------------------------------------------------- #
# ◆ Subform · Feedback Recipients
# --------------------------------------------------------------------- #
def _validate_recipient(data: dict) -> None:
    if not (data.get("respondent_team") or data.get("respondent_person")):
        raise ApiError("「Respondent Team / Person」至少填写一个",
                       field="respondent_person")
    check_enum(data, "response_status", RESPONSE_STATUSES, "Response Status", required=True)
    check_date(data, "response_due_date", "Response Due Date")
    check_date(data, "response_actual_date", "Response Actual Date")


def _insert_recipient(action_id: int, payload: dict) -> int:
    data = clean(payload, RECIPIENT_FIELDS)
    data.setdefault("response_status", "Open")
    _validate_recipient(data)
    data["action_item_id"] = action_id
    data["created_by"] = current_user()
    data["created_at"] = now()
    lookups_service.ensure_values("team", [data.get("respondent_team")])
    lookups_service.ensure_values("person", [data.get("respondent_person")])
    recipient_id = db.insert("feedback_recipient", data)
    status.seed_initial("feedback_recipient", recipient_id, "response_status",
                        data["response_status"], today())
    return recipient_id


@bp.get("/<int:action_id>/recipients")
def list_recipients(action_id):
    _get(action_id)
    return jsonify(_recipients(action_id))


@bp.post("/<int:action_id>/recipients")
def create_recipient(action_id):
    action = _get(action_id)
    if action["item_type"] != "Collect Comments":
        raise ApiError("只有 Collect Comments 类事项才能添加反馈对象")
    _insert_recipient(action_id, payload_of(request))
    db.commit()
    return jsonify(_recipients(action_id)), 201


@bp.put("/recipients/<int:recipient_id>")
def update_recipient(recipient_id):
    row = db.query_one("SELECT * FROM feedback_recipient WHERE id = ?", (recipient_id,))
    if not row:
        raise ApiError("反馈对象不存在", 404)
    data = clean(payload_of(request), RECIPIENT_FIELDS)
    merged = {**row, **data}
    _validate_recipient(merged)
    if data.get("response_status") and data["response_status"] != row["response_status"]:
        status.add("feedback_recipient", recipient_id, "response_status", {
            "new_value": data["response_status"],
            "effective_date": data.get("response_actual_date") or today(),
            "note": "在反馈对象行内更新",
        })
        data.pop("response_status")
    db.update("feedback_recipient", recipient_id, data)
    db.commit()
    return jsonify(_recipients(row["action_item_id"]))


@bp.delete("/recipients/<int:recipient_id>")
def remove_recipient(recipient_id):
    row = db.query_one("SELECT * FROM feedback_recipient WHERE id = ?", (recipient_id,))
    if not row:
        raise ApiError("反馈对象不存在", 404)
    db.delete("feedback_recipient", recipient_id)
    db.commit()
    return jsonify(_recipients(row["action_item_id"]))


@bp.get("/recipients/<int:recipient_id>/comment-draft")
def comment_draft(recipient_id):
    """「+ 生成 Comment」的预填数据：把事项与反馈内容带进意见矩阵。"""
    row = db.query_one(
        """SELECT r.*, a.standard_id, a.draft_id, a.related_clause, a.title, a.item_no
             FROM feedback_recipient r JOIN action_item a ON a.id = r.action_item_id
            WHERE r.id = ?""", (recipient_id,))
    if not row:
        raise ApiError("反馈对象不存在", 404)
    existing = db.query_one(
        "SELECT id, comment_no FROM comment WHERE source_recipient_id = ?", (recipient_id,))
    return jsonify({
        "existing": existing,
        "prefill": {
            "standard_id": row["standard_id"],
            "draft_id": row["draft_id"],
            "clause_no": row["related_clause"],
            "topic": row["title"],
            "comment_text": row["response_summary"] or "",
            "rationale": "",
            "status": "Draft",
            "submitted_by": row["respondent_person"] or row["respondent_team"] or "",
            "source_recipient_id": recipient_id,
        },
    })
