"""4. Comment Matrix 意见矩阵 + ◆ Subform · Comment Status History。"""

from flask import Blueprint, jsonify, request

import db
import grouped
import lookups_service
import status
from common import (
    ApiError, check_date, check_enum, clean, payload_of, require,
    stamp_create, stamp_update, today,
)
from constants import COMMENT_STATUSES, SUBMISSION_CHANNELS

bp = Blueprint("comments", __name__, url_prefix="/api/comments")

FIELDS = ["standard_id", "draft_id", "clause_no", "topic", "comment_text", "rationale",
          "status", "submitted_by", "submission_channel", "submission_date",
          "response", "follow_up", "source_recipient_id"]

_SELECT = """
SELECT c.*, s.std_no, s.name_cn, s.stage_code,
       d.version_name, d.sub_version_no
  FROM comment c
  JOIN standard s ON s.id = c.standard_id
  LEFT JOIN draft d ON d.id = c.draft_id
"""


def _get(comment_id: int) -> dict:
    row = db.query_one(_SELECT + " WHERE c.id = ?", (comment_id,))
    if not row:
        raise ApiError("意见不存在", 404)
    return row


def _validate(data: dict) -> None:
    require(data, [("standard_id", "Standard"), ("comment_text", "Comment / Proposal"),
                   ("rationale", "Rationale"), ("status", "Comment Status"),
                   ("submitted_by", "Submitted By")])
    check_enum(data, "status", COMMENT_STATUSES, "Comment Status", required=True)
    check_enum(data, "submission_channel", SUBMISSION_CHANNELS, "Submission Channel")
    check_date(data, "submission_date", "Submission Date")
    if not db.query_one("SELECT id FROM standard WHERE id = ?", (data["standard_id"],)):
        raise ApiError("所选标准不存在", field="standard_id")
    if data.get("draft_id"):
        d = db.query_one("SELECT standard_id FROM draft WHERE id = ?", (data["draft_id"],))
        if not d:
            raise ApiError("所选草案不存在", field="draft_id")
        if int(d["standard_id"]) != int(data["standard_id"]):
            raise ApiError("草案必须属于所选标准", field="draft_id")


@bp.get("")
def list_comments():
    where, params = ["s.archived_at IS NULL"], []
    q = (request.args.get("q") or "").strip()
    if q:
        where.append("(c.comment_no LIKE ? OR c.comment_text LIKE ? OR COALESCE(c.topic,'') LIKE ?"
                     " OR COALESCE(c.clause_no,'') LIKE ? OR s.std_no LIKE ? OR s.name_cn LIKE ?)")
        params += [f"%{q}%"] * 6
    for field, arg in (("c.status", "status"), ("c.standard_id", "standard_id"),
                       ("c.draft_id", "draft_id"), ("c.submitted_by", "submitted_by")):
        val = (request.args.get(arg) or "").strip()
        if val:
            where.append(f"{field} = ?")
            params.append(val)

    clause = " WHERE " + " AND ".join(where)
    return grouped.response(f"""
        SELECT c.standard_id AS group_key, c.*, s.std_no, s.name_cn, s.stage_code,
               d.version_name, d.sub_version_no
          FROM comment c
          JOIN standard s ON s.id = c.standard_id
          LEFT JOIN draft d ON d.id = c.draft_id
          {clause}
    """, params)


@bp.get("/<int:comment_id>")
def detail(comment_id):
    row = _get(comment_id)
    row["status_history"] = status.history("comment", comment_id, "status")
    return jsonify(row)


@bp.post("")
def create():
    payload = payload_of(request)
    data = clean(payload, FIELDS)
    data.setdefault("status", "Draft")
    _validate(data)
    data["comment_no"] = db.next_serial("comment", "comment_no", "CM", today()[:4])
    comment_id = db.insert("comment", stamp_update(stamp_create(data)))
    status.seed_initial("comment", comment_id, "status", data["status"],
                        payload.get("status_effective_date") or today())
    lookups_service.ensure_values("person", [data.get("submitted_by")])
    db.commit()
    return jsonify(detail_payload(comment_id)), 201


@bp.put("/<int:comment_id>")
def update(comment_id):
    _get(comment_id)
    data = clean(payload_of(request), FIELDS)
    data.pop("status", None)   # 状态只能通过状态历史推进
    _validate({**_get(comment_id), **data})
    db.update("comment", comment_id, stamp_update(data))
    lookups_service.ensure_values("person", [data.get("submitted_by")])
    db.commit()
    return jsonify(detail_payload(comment_id))


@bp.delete("/<int:comment_id>")
def remove(comment_id):
    _get(comment_id)
    db.delete("comment", comment_id)
    db.commit()
    return jsonify(ok=True)


def detail_payload(comment_id: int) -> dict:
    row = _get(comment_id)
    row["status_history"] = status.history("comment", comment_id, "status")
    return row


# --------------------------------------------------------------------- #
# ◆ Subform · Comment Status History
# --------------------------------------------------------------------- #
@bp.get("/<int:comment_id>/status-history")
def status_history(comment_id):
    _get(comment_id)
    return jsonify(status.history("comment", comment_id, "status"))


@bp.post("/<int:comment_id>/status-history")
def add_status(comment_id):
    _get(comment_id)
    row = status.add("comment", comment_id, "status", payload_of(request))
    return jsonify(history=row, comment=_get(comment_id)), 201
