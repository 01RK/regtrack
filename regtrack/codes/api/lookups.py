"""字典表：影响领域 / 人员 / 团队 / 机构 / TC-WG。

下拉框既能选，也能现场新增：现场新增的值随业务记录一起保存
（见 lookups_service），本模块负责字典本身的维护与查询。
"""

from flask import Blueprint, jsonify, request

import db
import lookups_service
from common import ApiError, payload_of
from constants import LOOKUP_CATEGORIES

bp = Blueprint("lookups", __name__, url_prefix="/api/lookups")


@bp.get("")
def list_all():
    """一次取回全部类别，前端启动时缓存。"""
    rows = db.query(
        "SELECT id, category, value, note, sort_order, is_active FROM lookup_value "
        " ORDER BY category, sort_order, value")
    grouped = {k: [] for k in LOOKUP_CATEGORIES}
    for r in rows:
        grouped.setdefault(r["category"], []).append(r)
    return jsonify(grouped)


@bp.get("/<category>")
def list_one(category):
    lookups_service.check_category(category)
    active_only = request.args.get("all") != "1"
    sql = "SELECT * FROM lookup_value WHERE category = %s"
    if active_only:
        sql += " AND is_active = 1"
    sql += " ORDER BY sort_order, value"
    return jsonify(db.query(sql, (category,)))


def _ensure_department(category: str, note: str | None) -> None:
    """人员的说明就是所在部门：新键入的部门同时写进「团队 / 部门」字典（同一事务）。"""
    if category == "person":
        lookups_service.ensure_values("team", [note])


@bp.post("/<category>")
def create(category):
    payload = payload_of(request)
    value = (payload.get("value") or "").strip()
    if not value:
        raise ApiError("字典值不能为空", field="value")
    note = (payload.get("note") or "").strip() or None

    existing = db.query_one(
        "SELECT * FROM lookup_value WHERE category = %s AND value = %s",
        (lookups_service.check_category(category), value))
    _ensure_department(category, note)
    if existing:
        row = lookups_service.ensure_values(category, [value])[0]
        if note and note != row["note"]:
            db.update("lookup_value", row["id"], {"note": note})
            row["note"] = note
        db.commit()
        return jsonify(row), 200

    new_id = db.insert("lookup_value", {
        "category": category,
        "value": value,
        "note": note,
        "sort_order": (db.query_one(
            "SELECT MAX(sort_order) AS max_order FROM lookup_value WHERE category = %s",
            (category,))["max_order"] or 0) + 1,
        "is_active": 1,
    })
    db.commit()
    return jsonify(db.query_one("SELECT * FROM lookup_value WHERE id = %s", (new_id,))), 201


@bp.put("/<int:row_id>")
def update(row_id):
    payload = payload_of(request)
    data = {}
    if "value" in payload:
        value = (payload["value"] or "").strip()
        if not value:
            raise ApiError("字典值不能为空", field="value")
        data["value"] = value
    if "note" in payload:
        data["note"] = (payload["note"] or "").strip() or None
    if "is_active" in payload:
        data["is_active"] = 1 if payload["is_active"] else 0
    if not data:
        raise ApiError("没有需要更新的字段")
    row = db.query_one("SELECT category FROM lookup_value WHERE id = %s", (row_id,))
    if not row:
        raise ApiError("字典值不存在", 404)
    _ensure_department(row["category"], data.get("note"))
    db.update("lookup_value", row_id, data)
    db.commit()
    return jsonify(db.query_one("SELECT * FROM lookup_value WHERE id = %s", (row_id,)))


@bp.delete("/<int:row_id>")
def remove(row_id):
    from api.file_manager import assert_workgroups_empty
    assert_workgroups_empty([row_id])
    db.delete("lookup_value", row_id)
    db.commit()
    return jsonify(ok=True)


@bp.put("/<category>/order")
def reorder(category):
    """保存完整分类顺序；一次事务更新，避免逐条请求留下半份排序。"""
    lookups_service.check_category(category)
    ids = payload_of(request).get("ids")
    if not isinstance(ids, list) or any(type(row_id) is not int for row_id in ids):
        raise ApiError("请提供字典项编号列表")
    current = db.query("SELECT id FROM lookup_value WHERE category = %s", (category,))
    if len(ids) != len(set(ids)) or set(ids) != {row["id"] for row in current}:
        raise ApiError("字典项已发生变化，请刷新后重新排序", 409)
    for position, row_id in enumerate(ids, 1):
        db.update("lookup_value", row_id, {"sort_order": position})
    db.commit()
    return jsonify(db.query("SELECT * FROM lookup_value WHERE category = %s ORDER BY sort_order", (category,)))
