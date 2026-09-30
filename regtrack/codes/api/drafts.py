"""2. Draft Registry 草案登记 + ◆ Subform · Clause Evolution 条款变化。"""

from flask import Blueprint, jsonify, request

import db
import grouped
import lookups_service
from common import (
    ApiError, check_date, check_enum, clean, payload_of, require,
    stamp_create, stamp_update,
)
from constants import (
    CHANGE_TYPES, OVERALL_IMPACTS, RISK_LEVELS, VERSION_NAMES, YES_NO_TBD,
)

bp = Blueprint("drafts", __name__, url_prefix="/api/drafts")

FIELDS = ["standard_id", "version_name", "sub_version_no", "draft_date", "file_link",
          "issued_by", "main_summary", "overall_impact", "notes"]

CLAUSE_FIELDS = ["last_draft_id", "current_clause_no", "last_clause_no", "topic",
                 "last_clause_text", "current_clause_text", "change_type", "change_desc",
                 "interpretation", "test_impact", "homologation_impact",
                 "compliance_risk", "responsible_person"]

_DRAFT_SELECT = """
SELECT d.*, s.std_no, s.name_cn, s.stage_code,
       (SELECT COUNT(*) FROM clause_evolution ce WHERE ce.draft_id = d.id) AS clause_count
  FROM draft d JOIN standard s ON s.id = d.standard_id
"""


def _get(draft_id: int) -> dict:
    row = db.query_one(_DRAFT_SELECT + " WHERE d.id = ?", (draft_id,))
    if not row:
        raise ApiError("草案不存在", 404)
    return row


def _validate(data: dict) -> None:
    require(data, [("standard_id", "Standard"), ("version_name", "Version Name"),
                   ("sub_version_no", "Draft Sub-Version No."), ("draft_date", "Draft Date")])
    if not db.query_one("SELECT id FROM standard WHERE id = ?", (data["standard_id"],)):
        raise ApiError("所选标准不存在，请先在标准主档建档", field="standard_id")
    check_enum(data, "version_name", VERSION_NAMES, "Version Name", required=True)
    check_date(data, "draft_date", "Draft Date")
    check_enum(data, "overall_impact", OVERALL_IMPACTS, "Overall Impact")


# --------------------------------------------------------------------- #
# 草案
# --------------------------------------------------------------------- #
@bp.get("")
def list_drafts():
    where, params = ["s.archived_at IS NULL"], []
    q = (request.args.get("q") or "").strip()
    if q:
        where.append("(s.std_no LIKE ? OR s.name_cn LIKE ? OR d.version_name LIKE ?"
                     " OR COALESCE(d.main_summary,'') LIKE ?)")
        params += [f"%{q}%"] * 4
    if request.args.get("standard_id"):
        where.append("d.standard_id = ?")
        params.append(request.args["standard_id"])
    if request.args.get("impact"):
        where.append("d.overall_impact = ?")
        params.append(request.args["impact"])

    clause = " WHERE " + " AND ".join(where)
    return grouped.response(f"""
        SELECT d.standard_id AS group_key, d.*, s.std_no, s.name_cn, s.stage_code,
               (SELECT COUNT(*) FROM clause_evolution ce WHERE ce.draft_id = d.id)
                   AS clause_count
          FROM draft d
          JOIN standard s ON s.id = d.standard_id
          {clause}
    """, params)


@bp.get("/options")
def options():
    """按标准过滤的草案下拉；冗余显示版本名 + 子版本 + 日期。"""
    standard_id = request.args.get("standard_id")
    if not standard_id:
        return jsonify([])
    return jsonify(db.query(
        """SELECT id, version_name, sub_version_no, draft_date, overall_impact
             FROM draft WHERE standard_id = ?
            ORDER BY draft_date DESC, id DESC""", (standard_id,)))


@bp.get("/<int:draft_id>")
def detail(draft_id):
    draft = _get(draft_id)
    draft["clauses"] = _clauses(draft_id)
    draft["sibling_versions"] = db.query(
        """SELECT id, version_name, sub_version_no, draft_date FROM draft
            WHERE standard_id = ? AND id <> ?
            ORDER BY draft_date DESC, id DESC""", (draft["standard_id"], draft_id))
    draft["comments"] = db.query(
        """SELECT id, comment_no, clause_no, topic, status, submitted_by
             FROM comment WHERE draft_id = ? ORDER BY id DESC""", (draft_id,))
    return jsonify(draft)


@bp.post("")
def create():
    data = clean(payload_of(request), FIELDS)
    _validate(data)
    draft_id = db.insert("draft", stamp_update(stamp_create(data)))
    lookups_service.ensure_values("organization", [data.get("issued_by")])
    db.commit()
    return jsonify(_get(draft_id)), 201


@bp.put("/<int:draft_id>")
def update(draft_id):
    _get(draft_id)
    data = clean(payload_of(request), FIELDS)
    _validate({**_get(draft_id), **data})
    db.update("draft", draft_id, stamp_update(data))
    lookups_service.ensure_values("organization", [data.get("issued_by")])
    db.commit()
    return jsonify(_get(draft_id))


@bp.delete("/<int:draft_id>")
def remove(draft_id):
    _get(draft_id)
    db.delete("draft", draft_id)
    db.commit()
    return jsonify(ok=True)


# --------------------------------------------------------------------- #
# ◆ Subform · Clause Evolution（全系统唯一的条款变化入口）
# --------------------------------------------------------------------- #
def _clauses(draft_id: int) -> list[dict]:
    return db.query(
        """SELECT ce.*, ld.version_name AS last_version_name,
                  ld.sub_version_no AS last_sub_version_no
             FROM clause_evolution ce
             LEFT JOIN draft ld ON ld.id = ce.last_draft_id
            WHERE ce.draft_id = ? ORDER BY ce.current_clause_no, ce.id""", (draft_id,))


def _validate_clause(data: dict, draft: dict) -> None:
    require(data, [("current_clause_no", "Current Clause No."), ("topic", "Topic"),
                   ("change_type", "Change Type"),
                   ("change_desc", "Description of Change")])
    check_enum(data, "change_type", CHANGE_TYPES, "Change Type", required=True)
    check_enum(data, "test_impact", YES_NO_TBD, "Test Impact")
    check_enum(data, "homologation_impact", RISK_LEVELS, "Homologation Impact")
    check_enum(data, "compliance_risk", RISK_LEVELS, "Compliance Risk")

    last_id = data.get("last_draft_id")
    if last_id:
        base = db.query_one("SELECT standard_id FROM draft WHERE id = ?", (last_id,))
        if not base:
            raise ApiError("对比版本不存在", field="last_draft_id")
        if base["standard_id"] != draft["standard_id"]:
            raise ApiError("对比版本必须属于同一个标准", field="last_draft_id")
        if int(last_id) == draft["id"]:
            raise ApiError("对比版本不能是当前版本本身", field="last_draft_id")
    else:
        # 该标准已有其它版本时，必须指明对比基准；首版才允许留空
        others = db.query_one(
            "SELECT COUNT(*) c FROM draft WHERE standard_id = ? AND id <> ?",
            (draft["standard_id"], draft["id"]))["c"]
        if others:
            raise ApiError("「Draft Ver Last」为必填项：该标准已有其它版本可供对比",
                           field="last_draft_id")


@bp.get("/<int:draft_id>/clauses")
def list_clauses(draft_id):
    _get(draft_id)
    return jsonify(_clauses(draft_id))


@bp.post("/<int:draft_id>/clauses")
def create_clause(draft_id):
    draft = _get(draft_id)
    data = clean(payload_of(request), CLAUSE_FIELDS)
    _validate_clause(data, draft)
    data["draft_id"] = draft_id
    clause_id = db.insert("clause_evolution", stamp_update(stamp_create(data)))
    lookups_service.ensure_values("person", [data.get("responsible_person")])
    db.commit()
    return jsonify(db.query_one(
        "SELECT * FROM clause_evolution WHERE id = ?", (clause_id,))), 201


@bp.put("/clauses/<int:clause_id>")
def update_clause(clause_id):
    row = db.query_one("SELECT * FROM clause_evolution WHERE id = ?", (clause_id,))
    if not row:
        raise ApiError("条款变化记录不存在", 404)
    draft = _get(row["draft_id"])
    data = clean(payload_of(request), CLAUSE_FIELDS)
    _validate_clause({**row, **data}, draft)
    db.update("clause_evolution", clause_id, stamp_update(data))
    lookups_service.ensure_values("person", [data.get("responsible_person")])
    db.commit()
    return jsonify(db.query_one("SELECT * FROM clause_evolution WHERE id = ?", (clause_id,)))


@bp.delete("/clauses/<int:clause_id>")
def remove_clause(clause_id):
    db.delete("clause_evolution", clause_id)
    db.commit()
    return jsonify(ok=True)


# --------------------------------------------------------------------- #
# 条款变化全局检索（跨标准查“某条款改过几次”）
# --------------------------------------------------------------------- #
@bp.get("/clauses/search")
def search_clauses():
    where, params = ["s.archived_at IS NULL"], []
    q = (request.args.get("q") or "").strip()
    if q:
        where.append("(ce.current_clause_no LIKE ? OR ce.topic LIKE ?"
                     " OR ce.change_desc LIKE ? OR s.std_no LIKE ? OR s.name_cn LIKE ?)")
        params += [f"%{q}%"] * 5
    for field, arg in (("ce.change_type", "change_type"),
                       ("ce.compliance_risk", "risk"),
                       ("ce.test_impact", "test_impact"),
                       ("d.standard_id", "standard_id")):
        val = (request.args.get(arg) or "").strip()
        if val:
            where.append(f"{field} = ?")
            params.append(val)
    clause = " WHERE " + " AND ".join(where)
    return grouped.response(f"""
        SELECT d.standard_id AS group_key, ce.*, d.standard_id AS standard_id,
               s.std_no, s.name_cn, d.version_name, d.sub_version_no,
               ld.version_name AS last_version_name,
               ld.sub_version_no AS last_sub_version_no
          FROM clause_evolution ce
          JOIN draft d ON d.id = ce.draft_id
          JOIN standard s ON s.id = d.standard_id
          LEFT JOIN draft ld ON ld.id = ce.last_draft_id
          {clause}
    """, params)
