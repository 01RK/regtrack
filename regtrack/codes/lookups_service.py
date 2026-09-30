"""字典写入服务。

业务表单里的字典字段（TC/WG、责任单位、人员、影响领域…）允许现场输入新值：
保存业务记录时由后端在同一个事务里补齐字典项，用户不必先去设置页维护字典，
也不会因为「字典里没有这个值」而保存失败。
"""

import db
from common import ApiError
from constants import LOOKUP_CATEGORIES


def check_category(category: str) -> str:
    if category not in LOOKUP_CATEGORIES:
        raise ApiError(f"未知字典类别：{category}", 404,
                       detail="可选类别：" + ", ".join(LOOKUP_CATEGORIES))
    return category


def ensure_values(category: str, values) -> list[dict]:
    """把值补进字典：已存在则保持原样，停用的重新启用，不存在的新建。

    不单独提交事务——调用方（业务记录的保存流程）统一提交或回滚，
    保证「标准存上了但字典没写进去」这种半截状态不会出现。
    """
    check_category(category)
    saved = []
    for raw in values:
        value = (raw or "").strip()
        if not value:
            continue
        row = db.query_one(
            "SELECT * FROM lookup_value WHERE category = ? AND value = ?",
            (category, value))
        if row:
            if not row["is_active"]:
                db.update("lookup_value", row["id"], {"is_active": 1})
                row["is_active"] = 1
            saved.append(row)
            continue
        tail = db.query_one(
            "SELECT MAX(sort_order) AS m FROM lookup_value WHERE category = ?",
            (category,))
        new_id = db.insert("lookup_value", {
            "category": category,
            "value": value,
            "note": "业务录入时新增",
            "sort_order": (tail["m"] or 0) + 10,
            "is_active": 1,
        })
        saved.append(db.query_one("SELECT * FROM lookup_value WHERE id = ?", (new_id,)))
    return saved
