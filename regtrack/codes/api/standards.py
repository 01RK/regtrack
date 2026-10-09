"""1. Standard Profile 标准主档。"""

from flask import Blueprint, jsonify, request

import db
import lookups_service
import stages
from common import (
    ApiError, check_date, check_enum, clean, current_user, now, paginate,
    payload_of, require, stamp_create, stamp_update, today,
)
from constants import RISK_LEVELS, STANDARD_LOOKUP_FIELDS, STANDARD_TYPES

bp = Blueprint("standards", __name__, url_prefix="/api/standards")

FIELDS = [
    "std_no", "name_cn", "name_en", "std_type", "tc_wg",
    "responsible_authority", "leading_org", "risk_level", "mb_owner",
    "planned_release_date", "actual_release_date", "effective_date", "scope",
]


def _validate(data: dict) -> None:
    require(data, [("name_cn", "Standard Name CN 中文名称")])
    check_enum(data, "std_type", STANDARD_TYPES, "Standard Type")
    check_enum(data, "risk_level", RISK_LEVELS, "Current Risk Level")
    for f, label in (("planned_release_date", "Planned Release Date"),
                     ("actual_release_date", "Actual Release Date"),
                     ("effective_date", "Effective Date")):
        check_date(data, f, label)


def _save_impact_areas(standard_id: int, areas) -> None:
    if areas is None:
        return
    values = sorted({a.strip() for a in areas if a and a.strip()})
    db.execute("DELETE FROM standard_impact_area WHERE standard_id = ?", (standard_id,))
    for area in values:
        db.insert("standard_impact_area",
                  {"standard_id": standard_id, "impact_area": area})
    # 首次录入的影响领域同步进字典，下次别人可以直接选到
    lookups_service.ensure_values("impact_area", values)


def _save_lookup_fields(data: dict) -> None:
    """标准主档里的字典型字段：不存在的值直接建字典项，与标准一并保存。"""
    for field, category in STANDARD_LOOKUP_FIELDS.items():
        if data.get(field):
            lookups_service.ensure_values(category, [data[field]])


def _get(standard_id: int) -> dict:
    row = db.query_one("SELECT * FROM v_standard_overview WHERE id = ?", (standard_id,))
    if not row:
        raise ApiError("标准不存在", 404)
    row["impact_area_list"] = [
        r["impact_area"] for r in db.query(
            "SELECT impact_area FROM standard_impact_area WHERE standard_id = ? "
            " ORDER BY impact_area", (standard_id,))]
    row["stage"] = stages.label(row["stage_code"])
    row["archived"] = bool(row["archived_at"])
    return row


# --------------------------------------------------------------------- #
# 列表 / 搜索
# --------------------------------------------------------------------- #
@bp.get("")
def list_standards():
    # 归档的标准默认不出现在列表里，但数据完整保留，可用 archived=1 查阅
    where = ["archived_at IS NOT NULL" if request.args.get("archived") == "1"
             else "archived_at IS NULL"]
    params = []
    q = (request.args.get("q") or "").strip()
    if q:
        where.append("(std_no LIKE ? OR name_cn LIKE ? OR COALESCE(name_en,'') LIKE ?"
                     " OR COALESCE(tc_wg,'') LIKE ?)")
        params += [f"%{q}%"] * 4
    for field, arg in (("stage_code", "stage"), ("risk_level", "risk"),
                       ("std_type", "type"), ("mb_owner", "owner")):
        val = (request.args.get(arg) or "").strip()
        if val:
            where.append(f"{field} = ?")
            params.append(val)

    clause = " WHERE " + " AND ".join(where)
    total = db.query_one(f"SELECT COUNT(*) c FROM standard{clause}", params)["c"]
    limit, offset = paginate(request.args)
    rows = db.query(
        f"SELECT * FROM v_standard_overview{clause} "
        f" ORDER BY std_no LIMIT ? OFFSET ?", params + [limit, offset])
    for row in rows:
        row["stage"] = stages.label(row["stage_code"])
        row["archived"] = bool(row["archived_at"])
    return jsonify(total=total, items=rows)


@bp.get("/options")
def options():
    """可搜索下拉框数据源。

    额外返回阶段、TC/WG、草案数——下拉里冗余显示这些信息，
    同事不用另开页面就能确认自己选的是不是那一条。归档标准不参与选择。
    """
    q = (request.args.get("q") or "").strip()
    params, clause = [], " WHERE s.archived_at IS NULL"
    if q:
        clause += (" AND (s.std_no LIKE ? OR s.name_cn LIKE ?"
                   " OR COALESCE(s.name_en,'') LIKE ?)")
        params = [f"%{q}%"] * 3
    rows = db.query(
        f"""SELECT s.id, s.std_no, s.name_cn, s.name_en, s.stage_code, s.tc_wg,
                   s.risk_level, s.mb_owner,
                   (SELECT COUNT(*) FROM draft d WHERE d.standard_id = s.id) AS draft_count
              FROM standard s{clause}
             ORDER BY s.std_no LIMIT 50""", params)
    for row in rows:
        row["stage"] = stages.label(row["stage_code"])
    return jsonify(rows)


# --------------------------------------------------------------------- #
# 明细 / 写入
# --------------------------------------------------------------------- #
@bp.get("/<int:standard_id>")
def detail(standard_id):
    std = _get(standard_id)
    std["stage_timeline"] = stages.timeline(standard_id, std["stage_code"])
    std["stage_history"] = stages.records(standard_id)
    std["drafts"] = db.query(
        """SELECT d.*, (SELECT COUNT(*) FROM v_current_draft_chapter ce WHERE ce.draft_id = d.id)
                  AS clause_count
             FROM draft d WHERE d.standard_id = ?
            ORDER BY d.draft_date DESC, d.id DESC""", (standard_id,))
    std["meetings"] = db.query(
        """SELECT m.id, m.meeting_no, m.title, m.meeting_date, m.meeting_type
             FROM meeting m JOIN meeting_standard ms ON ms.meeting_id = m.id
            WHERE ms.standard_id = ? ORDER BY m.meeting_date DESC""", (standard_id,))
    std["comments"] = db.query(
        """SELECT c.id, c.comment_no, c.clause_no, c.topic, c.status, c.submitted_by,
                  c.submission_date
             FROM comment c WHERE c.standard_id = ? ORDER BY c.id DESC""", (standard_id,))
    std["actions"] = db.query(
        """SELECT a.id, a.item_no, a.item_type, a.title, a.current_status, a.priority,
                  COALESCE(a.submission_due_date, a.check_due_date, a.target_date) AS due_date
             FROM action_item a WHERE a.standard_id = ? ORDER BY a.id DESC""",
        (standard_id,))
    return jsonify(std)


@bp.post("")
def create():
    payload = payload_of(request)
    data = clean(payload, FIELDS)
    _validate(data)
    stage_code = stages.check_code((payload.get("stage_code") or "").strip())
    effective_date = (payload.get("stage_effective_date") or "").strip() or today()
    check_date({"d": effective_date}, "d", "进入该阶段的日期")

    # 主档、影响领域、字典值与首条阶段记录必须一起成功或一起失败，
    # 中途出错时整条事务回滚，不会留下半条标准。
    try:
        standard_id = db.insert("standard",
                                stamp_update(stamp_create(dict(data, stage_code=stage_code))))
        _save_lookup_fields(data)
        _save_impact_areas(standard_id, payload.get("impact_area_list"))
        stages.seed_initial(standard_id, stage_code, effective_date)
        db.commit()
    except Exception:
        db.rollback()
        raise
    return jsonify(_get(standard_id)), 201


@bp.put("/<int:standard_id>")
def update(standard_id):
    current = _get(standard_id)
    payload = payload_of(request)
    data = clean(payload, FIELDS)
    _validate({**current, **data})
    try:
        db.update("standard", standard_id, stamp_update(data))
        _save_lookup_fields(data)
        _save_impact_areas(standard_id, payload.get("impact_area_list"))
        db.commit()
    except Exception:
        db.rollback()
        raise
    return jsonify(_get(standard_id))


@bp.delete("/<int:standard_id>")
def archive(standard_id):
    """归档：标准从正常列表中隐去，主档、阶段历史与关联记录全部保留。"""
    std = _get(standard_id)
    if std["archived"]:
        raise ApiError("该标准已归档")
    db.update("standard", standard_id,
              stamp_update({"archived_at": now(), "archived_by": current_user()}))
    db.commit()
    return jsonify(_get(standard_id))


@bp.post("/<int:standard_id>/restore")
def restore(standard_id):
    std = _get(standard_id)
    if not std["archived"]:
        raise ApiError("该标准不在归档中")
    db.update("standard", standard_id,
              stamp_update({"archived_at": None, "archived_by": None}))
    db.commit()
    return jsonify(_get(standard_id))


# --------------------------------------------------------------------- #
# ◆ Subform · Stage 推进 / 补录
# --------------------------------------------------------------------- #
@bp.get("/<int:standard_id>/stages")
def stage_timeline(standard_id):
    std = _get(standard_id)
    return jsonify(stage_code=std["stage_code"], stage=std["stage"],
                   timeline=stages.timeline(standard_id, std["stage_code"]),
                   records=stages.records(standard_id))


@bp.post("/<int:standard_id>/stages")
def add_stage(standard_id):
    _get(standard_id)
    payload = payload_of(request)
    stage_code = (payload.get("stage_code") or "").strip()
    require({"stage_code": stage_code}, [("stage_code", "Target Stage 目标阶段")])
    record = stages.add(standard_id, stage_code, payload)
    return jsonify(record=record, standard=_get(standard_id)), 201


@bp.put("/<int:standard_id>/stages/<int:record_id>")
def edit_stage(standard_id, record_id):
    _get(standard_id)
    record = stages.edit(standard_id, record_id, payload_of(request))
    return jsonify(record=record, standard=_get(standard_id))
