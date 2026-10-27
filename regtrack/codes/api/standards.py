"""1. Standard Profile 标准主档。"""

from flask import Blueprint, jsonify, request

import db
import lookups_service
import stages
import standard_removal
from common import (
    ApiError, check_date, check_enum, clean, current_user, now, paginate,
    payload_of, require, stamp_create, stamp_update, today,
)
from constants import RISK_LEVELS, STANDARD_LOOKUP_FIELDS, STANDARD_TYPES

bp = Blueprint("standards", __name__, url_prefix="/api/standards")

FIELDS = [
    "std_no", "plan_no", "name_cn", "name_en", "std_type", "tc_wg",
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
    db.execute("DELETE FROM standard_impact_area WHERE standard_id = %s", (standard_id,))
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


# 标准主档带关联计数（列表页与明细共用）
_OVERVIEW = """
SELECT s.*,
       (SELECT COUNT(*) FROM draft d WHERE d.standard_id = s.id) AS draft_count,
       (SELECT COUNT(*) FROM comment c WHERE c.standard_id = s.id) AS comment_count,
       (SELECT COUNT(*) FROM action_item a
         WHERE a.standard_id = s.id
           AND a.current_status NOT IN ('Completed', 'Closed', 'Cancelled')) AS todo_count,
       (SELECT COUNT(*) FROM meeting_standard ms WHERE ms.standard_id = s.id) AS meeting_count
  FROM standard s
"""


def _decorate(rows: list[dict]) -> list[dict]:
    """附上阶段名称、归档标记与影响领域（列表为逗号拼接文本，明细另带数组）。"""
    areas = {row["id"]: [] for row in rows}
    if areas:
        for r in db.query(
                f"SELECT standard_id, impact_area FROM standard_impact_area "
                f"WHERE standard_id IN ({db.marks(areas)}) ORDER BY impact_area", list(areas)):
            areas[r["standard_id"]].append(r["impact_area"])
    for row in rows:
        row["impact_area_list"] = areas[row["id"]]
        row["impact_areas"] = ", ".join(areas[row["id"]]) or None
        row["stage"] = stages.label(row["stage_code"])
        row["archived"] = bool(row["archived_at"])
    return rows


def _get(standard_id: int) -> dict:
    row = db.query_one(_OVERVIEW + " WHERE s.id = %s", (standard_id,))
    if not row:
        raise ApiError("标准不存在", 404)
    return _decorate([row])[0]


def _check_unique_no(std_no: str | None, standard_id: int = 0) -> None:
    """正式标准号唯一；空编号与 XXXX 占位编号可以重复。"""
    if not std_no or "XXXX" in std_no.upper():
        return
    if db.query_one("SELECT id FROM standard WHERE std_no = %s AND id <> %s", (std_no, standard_id)):
        raise ApiError(f"违反唯一性约束：标准号 {std_no} 已存在", field="std_no")


# --------------------------------------------------------------------- #
# 列表 / 搜索
# --------------------------------------------------------------------- #
@bp.get("")
def list_standards():
    # 归档的标准默认不出现在列表里，但数据完整保留，可用 archived=1 查阅
    where = ["s.archived_at IS NOT NULL" if request.args.get("archived") == "1"
             else "s.archived_at IS NULL"]
    params = []
    q = (request.args.get("q") or "").strip()
    if q:
        where.append("(s.plan_no ILIKE %s OR s.std_no ILIKE %s OR s.name_cn ILIKE %s OR s.name_en ILIKE %s OR s.tc_wg ILIKE %s)")
        params += [db.contains(q)] * 5
    for field, arg in (("stage_code", "stage"), ("risk_level", "risk"),
                       ("std_type", "type"), ("mb_owner", "owner")):
        val = (request.args.get(arg) or "").strip()
        if val:
            where.append(f"s.{field} = %s")
            params.append(val)

    limit, offset = paginate(request.args)
    clause=' AND '.join(where)
    total=db.query_one(f"SELECT COUNT(*) AS n FROM standard s WHERE {clause}",params)['n']
    rows=db.query(f"{_OVERVIEW} WHERE {clause} ORDER BY s.std_no,s.id LIMIT %s OFFSET %s",params+[limit,offset])
    return jsonify(total=total,items=_decorate(rows))


@bp.get("/options")
def options():
    """可搜索下拉框数据源。

    额外返回阶段、TC/WG、草案数——下拉里冗余显示这些信息，
    同事不用另开页面就能确认自己选的是不是那一条。归档标准不参与选择。
    """
    q = (request.args.get("q") or "").strip()
    params, clause = [], " WHERE s.archived_at IS NULL"
    if q:
        clause += " AND (s.plan_no ILIKE %s OR s.std_no ILIKE %s OR s.name_cn ILIKE %s OR s.name_en ILIKE %s)"
        params = [db.contains(q)] * 4
    rows = db.query(
        f"""SELECT s.id, s.plan_no, s.std_no, s.name_cn, s.name_en, s.stage_code, s.tc_wg,
                   s.risk_level, s.mb_owner,
                   (SELECT COUNT(*) FROM draft d WHERE d.standard_id = s.id) AS draft_count
              FROM standard s{clause}
             ORDER BY s.std_no, s.id""", params)[:50]
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
        """SELECT d.*, (SELECT COUNT(*) FROM draft_chapter ce WHERE ce.draft_id = d.id)
                  AS clause_count
             FROM draft d WHERE d.standard_id = %s
            ORDER BY d.draft_date DESC, d.id DESC""", (standard_id,))
    std["meetings"] = db.query(
        """SELECT m.id, m.meeting_no, m.title, m.meeting_date, m.meeting_type
             FROM meeting m INNER JOIN meeting_standard ms ON ms.meeting_id = m.id
            WHERE ms.standard_id = %s ORDER BY m.meeting_date DESC""", (standard_id,))
    std["comments"] = db.query(
        """SELECT c.id, c.comment_no, c.clause_no, c.source_kind, c.comment_type, c.before_clause_no, c.after_clause_no, c.status, c.submitted_by,
                  c.submission_date, d.version_name, d.sub_version_no,
                  bd.version_name AS before_version_name, bd.sub_version_no AS before_sub_version_no,
                  ad.version_name AS after_version_name, ad.sub_version_no AS after_sub_version_no
             FROM ((comment c LEFT JOIN draft d ON d.id = c.draft_id)
                   LEFT JOIN draft bd ON bd.id = c.before_draft_id)
                   LEFT JOIN draft ad ON ad.id = c.after_draft_id
             WHERE c.standard_id = %s ORDER BY c.id DESC""", (standard_id,))
    std["actions"] = db.query(
        f"""SELECT a.id, a.item_no, a.item_type, a.title, a.current_status, a.priority,
                  {db.coalesce("a.submission_due_date", "a.check_due_date", "a.target_date")} AS due_date
             FROM action_item a WHERE a.standard_id = %s ORDER BY a.id DESC""",
        (standard_id,))
    return jsonify(std)


@bp.post("")
def create():
    payload = payload_of(request)
    data = clean(payload, FIELDS)
    _validate(data)
    _check_unique_no(data.get("std_no"))
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
    if "std_no" in data:
        _check_unique_no(data["std_no"], standard_id)
    try:
        db.update("standard", standard_id, stamp_update(data))
        _save_lookup_fields(data)
        _save_impact_areas(standard_id, payload.get("impact_area_list"))
        db.commit()
    except Exception:
        db.rollback()
        raise
    return jsonify(_get(standard_id))


@bp.get("/<int:standard_id>/deletion")
def deletion_impact(standard_id):
    """删除前的影响范围，供危险操作确认框列出。"""
    std = _get(standard_id)
    return jsonify(dict(standard_removal.impact(standard_id), std_no=std["std_no"], name_cn=std["name_cn"]))


@bp.delete("/<int:standard_id>")
def remove(standard_id):
    """永久删除标准及其草案、意见、比对、事项；会议保留并解除挂载。"""
    _get(standard_id)
    removed = standard_removal.remove(standard_id)
    db.commit()
    return jsonify(removed)


@bp.post("/<int:standard_id>/archive")
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
