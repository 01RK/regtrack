"""三类通用状态历史的统一服务接口（文档 §6）。

数据库分别使用 comment_status_history、action_status_history 与
recipient_status_history，并通过真实外键关联主表。调用方只需提供新值、
生效日期与说明；上一值、记录人与当前状态由服务统一维护。

标准阶段不走这里：它按固定编码管理，且区分正常推进与历史补录，见 stages.py。
"""

import db
from common import ApiError, check_date, current_user, now, require
from constants import STATUS_FIELDS

# (实体类型, 状态字段) -> (主表, 历史表, 历史表外键)
_TARGETS = {
    ("comment", "status"):
        ("comment", "comment_status_history", "comment_id"),
    ("action_item", "current_status"):
        ("action_item", "action_status_history", "action_item_id"),
    ("feedback_recipient", "response_status"):
        ("feedback_recipient", "recipient_status_history", "feedback_recipient_id"),
}


def _resolve(entity_type: str, field_key: str):
    key = (entity_type, field_key)
    if key not in _TARGETS:
        raise ApiError(f"不支持的状态字段：{entity_type}.{field_key}", 404)
    entity_table, history_table, parent_key = _TARGETS[key]
    allowed, title = STATUS_FIELDS[key]
    return entity_table, history_table, parent_key, allowed, title


def history(entity_type: str, entity_id: int, field_key: str) -> list[dict]:
    _, history_table, parent_key, _, _ = _resolve(entity_type, field_key)
    return db.query(
        f"SELECT * FROM {history_table} WHERE {parent_key} = ? "
        "ORDER BY effective_date DESC, id DESC",
        (entity_id,),
    )


def add(entity_type: str, entity_id: int, field_key: str, payload: dict) -> dict:
    """新增一条状态变更，并同步主记录当前值。"""
    entity_table, history_table, parent_key, allowed, _ = _resolve(
        entity_type, field_key
    )
    row = db.query_one(
        f"SELECT {field_key} AS cur FROM {entity_table} WHERE id = ?",
        (entity_id,),
    )
    if row is None:
        raise ApiError("记录不存在", 404)

    new_value = (payload.get("new_value") or "").strip()
    effective_date = (payload.get("effective_date") or "").strip()
    require({"new_value": new_value, "effective_date": effective_date},
            [("new_value", "New Value"), ("effective_date", "Effective Date")])
    if new_value not in allowed:
        raise ApiError(f"取值不合法：{new_value}", field="new_value",
                       detail="可选值：" + "、".join(allowed))
    check_date({"effective_date": effective_date}, "effective_date", "Effective Date")

    history_id = db.insert(history_table, {
        parent_key: entity_id,
        "previous_value": row["cur"],
        "new_value": new_value,
        "effective_date": effective_date,
        "note": (payload.get("note") or "").strip() or None,
        "reference": (payload.get("reference") or "").strip() or None,
        "recorded_at": now(),
        "recorded_by": current_user(),
    })
    db.execute(
        f"UPDATE {entity_table} SET {field_key} = ? WHERE id = ?",
        (new_value, entity_id),
    )
    db.commit()
    return db.query_one(
        f"SELECT * FROM {history_table} WHERE id = ?", (history_id,)
    )


def seed_initial(entity_type: str, entity_id: int, field_key: str,
                 value: str, effective_date: str, note: str | None = None) -> None:
    """新建主记录时写入第一条历史，保证历史链从建档起就是完整的。"""
    _, history_table, parent_key, _, _ = _resolve(entity_type, field_key)
    db.insert(history_table, {
        parent_key: entity_id,
        "previous_value": None,
        "new_value": value,
        "effective_date": effective_date,
        "note": note or "建档初始值",
        "reference": None,
        "recorded_at": now(),
        "recorded_by": current_user(),
    })
