"""4. Comment Matrix 意见矩阵 + ◆ Subform · Comment Status History。"""

from flask import Blueprint, jsonify, request

import db
import comment_model
import opinion_service
import comment_history
import grouped
import lookups_service
import status
from common import (
    ApiError, clean, payload_of,
    stamp_create, stamp_update, today,
)

bp = Blueprint("comments", __name__, url_prefix="/api/comments")

FIELDS = ["standard_id", "source_kind", "comment_type", "draft_id", "clause_no",
          "before_draft_id", "before_clause_no", "after_draft_id", "after_clause_no",
          "comment_text", "needs_follow_up", "status", "submitted_by", "submission_date",
          "source_annotation_id"]

_SELECT = f"""
SELECT c.*, {comment_model.SUBMISSION_CHANNEL}, s.std_no, s.name_cn, s.stage_code,
       cc.comparison_id, co.change_id AS comparison_change_id,
       d.version_name, d.sub_version_no,
       bd.version_name AS before_version_name, bd.sub_version_no AS before_sub_version_no,
       ad.version_name AS after_version_name, ad.sub_version_no AS after_sub_version_no
  FROM (((((comment c
  INNER JOIN standard s ON s.id = c.standard_id)
  LEFT JOIN draft d ON d.id = c.draft_id)
  LEFT JOIN draft bd ON bd.id = c.before_draft_id)
  LEFT JOIN draft ad ON ad.id = c.after_draft_id)
  LEFT JOIN comparison_opinion co ON co.comment_id = c.id)
  LEFT JOIN comparison_change cc ON cc.id = co.change_id
"""


def _payload(payload):
    obsolete = set(payload) & {"topic", "rationale", "submission_channel", "response", "follow_up", "note", "reference"}
    if obsolete:
        raise ApiError("不支持的意见字段：" + "、".join(sorted(obsolete)), field=sorted(obsolete)[0])
    return clean(payload, FIELDS)




def _get(comment_id: int) -> dict:
    row = db.query_one(_SELECT + " WHERE c.id = %s", (comment_id,))
    if not row:
        raise ApiError("意见不存在", 404)
    return row




@bp.get("")
def list_comments():
    where, params = ["s.archived_at IS NULL"], []
    standard_q = (request.args.get("standard_q") or "").strip()
    if standard_q:
        where.append("(s.std_no ILIKE %s OR s.name_cn ILIKE %s)")
        params += [db.contains(standard_q)] * 2
    content_q = (request.args.get("content_q") or "").strip()
    if content_q:
        where.append("""(c.comment_text ILIKE %s OR EXISTS (
            SELECT 1 FROM comment_status_history h WHERE h.comment_id=c.id
            AND (h.response ILIKE %s OR h.follow_up ILIKE %s)))""")
        params += [db.contains(content_q)] * 3
    for field, arg in (("c.status", "status"), ("c.source_kind", "source_kind"),
                       ("c.comment_type", "comment_type"), ("c.submitted_by", "submitted_by")):
        val = (request.args.get(arg) or "").strip()
        if val:
            where.append(f"{field} = %s")
            params.append(val)
    standard_id = request.args.get("standard_id", type=int)
    if standard_id:
        where.append("c.standard_id = %s")
        params.append(standard_id)

    draft_id = request.args.get("draft_id", type=int)
    if draft_id:
        where.append("(c.draft_id=%s OR c.before_draft_id=%s OR c.after_draft_id=%s)")
        params += [draft_id] * 3
    return grouped.response(db.query(_SELECT + " WHERE " + " AND ".join(where), params))


@bp.get("/<int:comment_id>")
def detail(comment_id):
    row = _get(comment_id)
    row["status_history"] = status.history("comment", comment_id, "status")
    return jsonify(row)


@bp.post("")
def create():
    payload = payload_of(request)
    data = _payload(payload)
    opinion_service.apply_follow_up(data)
    comment_model.bind_annotation(data)
    comment_model.validate(data)
    data["comment_no"] = db.next_serial("comment", "comment_no", "CM", today()[:4])
    comment_id = db.insert("comment", stamp_update(stamp_create(data)))
    status.seed_initial("comment", comment_id, "status", data["status"],
                        payload.get("status_effective_date") or today())
    lookups_service.ensure_values("person", [data.get("submitted_by")])
    if "status_update" in payload:
        comment_history.append(comment_id, payload["status_update"])
    db.commit()
    return jsonify(detail_payload(comment_id)), 201


@bp.put("/<int:comment_id>")
def update(comment_id):
    previous = _get(comment_id)
    payload = payload_of(request)
    data = _payload(payload)
    data.pop("status", None)
    opinion_service.apply_follow_up(data, previous)
    if data.get("source_annotation_id") != previous.get("source_annotation_id") and "source_annotation_id" in data:
        raise ApiError("来源批注不能改写", field="source_annotation_id")
    if previous.get("source_annotation_id"):
        bound = dict(previous, **data)
        comment_model.bind_annotation(bound)
        data.update({k: bound[k] for k in ("source_kind", "standard_id", "draft_id", "clause_no",
                    "before_draft_id", "before_clause_no", "after_draft_id", "after_clause_no")})
    if db.query_one('SELECT id FROM comparison_opinion WHERE comment_id=%s', (comment_id,)):
        binding = ('standard_id', 'source_kind', 'before_draft_id', 'after_draft_id',
                   'before_clause_no', 'after_clause_no', 'draft_id', 'clause_no', 'source_annotation_id')
        if any(key in data and data[key] != previous.get(key) for key in binding):
            raise ApiError('Comparison opinion source cannot be changed / 比对批注的来源绑定不可修改')
    comment_model.validate({**previous, **data})
    opinion_service.record_change(previous, data)
    db.update("comment", comment_id, stamp_update(data))
    if previous.get("source_annotation_id"):
        merged = dict(previous, **data)
        db.update("draft_annotation", previous["source_annotation_id"], stamp_update(dict(
            content=merged["comment_text"], annotation_type=merged["comment_type"])))
    lookups_service.ensure_values("person", [data.get("submitted_by")])
    if "status_update" in payload:
        comment_history.append(comment_id, payload["status_update"])
    db.commit()
    return jsonify(detail_payload(comment_id))


@bp.delete("/<int:comment_id>")
def remove(comment_id):
    row = _get(comment_id)
    if row["source_annotation_id"]:
        db.delete("draft_annotation", row["source_annotation_id"])
    else:
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


