"""标准阶段服务：阶段编码、推进与补录、当前阶段计算。

规则（对应需求 3~6、9~11）：
  · 阶段一律以编码存取，显示名称由 constants.STAGES 提供，前端负责呈现；
  · 每个标准的每个阶段至多一条记录，同一阶段不重复填写；
  · 目标阶段在当前阶段之后 → 正常推进（ADVANCE），日期不得早于当前阶段；
  · 目标阶段在当前阶段之前 → 历史补录（BACKFILL），可填真实发生时间，
    不受当前阶段时间顺序限制，且在记录上留痕以便审计追溯；
  · 阶段记录写入后不锁定：两类记录的生效日期、依据与说明都能更正，
    审计追溯靠 created_at / created_by 与 updated_at / updated_by 四个
    时间戳字段（界面同时展示），阶段本身不可改写——换阶段是另一条记录；
  · 当前阶段永远由阶段记录计算得出（取已记录阶段中最靠后的一个），
    标准主档不能直接改写。
"""

import db
from common import ApiError, check_date, current_user, now, require
from constants import (
    STAGE_ADVANCE, STAGE_BACKFILL, STAGE_CODES, STAGE_LABELS, STAGE_ORDER,
    STAGE_RECORD_TYPES, STAGES,
)

FIELDS = ["stage_code", "effective_date", "note", "reference"]


def label(code: str) -> str:
    return STAGE_LABELS[code]


def check_code(code: str, field: str = "stage_code") -> str:
    if code not in STAGE_ORDER:
        raise ApiError(
            f"阶段编码不存在：{code or '空'}", field=field,
            detail="可选编码：" + ", ".join(STAGE_CODES))
    return code


def records(standard_id: int) -> list[dict]:
    """阶段记录（按阶段先后排序），附带显示名称与记录类型名称。"""
    rows = db.query(
        "SELECT * FROM standard_stage_history WHERE standard_id = ?",
        (standard_id,))
    rows.sort(key=lambda r: STAGE_ORDER[r["stage_code"]])
    for row in rows:
        _decorate(row)
    return rows


def _decorate(row: dict) -> dict:
    """附上显示名称、记录类型名称与「是否改过」。所有阶段记录都可修改。"""
    row["stage_label"] = label(row["stage_code"])
    row["record_type_label"] = STAGE_RECORD_TYPES[row["record_type"]]
    row["editable"] = True
    # updated_by 只在真正改过之后才落库，据此区分「未修改过」与「改过一次」，
    # 不靠比时间戳——同一秒内完成的修改也要认得出来。
    row["modified"] = bool(row.get("updated_by"))
    return row


def current_code(standard_id: int) -> str:
    """当前阶段 = 已记录阶段中最靠后的一个。"""
    rows = db.query(
        "SELECT stage_code FROM standard_stage_history WHERE standard_id = ?",
        (standard_id,))
    return max((r["stage_code"] for r in rows), key=lambda c: STAGE_ORDER[c])


def recompute(standard_id: int) -> str:
    code = current_code(standard_id)
    db.execute("UPDATE standard SET stage_code = ? WHERE id = ?", (code, standard_id))
    return code


def timeline(standard_id: int, stage_code: str) -> list[dict]:
    """完整九段时间轴：每一段要么已有记录，要么标出可补录 / 可推进。"""
    by_code = {r["stage_code"]: r for r in records(standard_id)}
    current_rank = STAGE_ORDER[stage_code]
    out = []
    for index, stage in enumerate(STAGES):
        code = stage["code"]
        record = by_code.get(code)
        if record:
            state = "current" if index == current_rank else "done"
        else:
            state = "missing" if index < current_rank else "future"
        out.append({
            "code": code,
            "label": stage["cn"],
            "en": stage["en"],
            "order": index,
            "state": state,
            "record": record,
            # 阶段记录不再锁定：已填写的阶段都能在阶段详情里更正
            "editable": bool(record),
            "record_type": "" if state in ("current", "done")
                           else (STAGE_BACKFILL if state == "missing" else STAGE_ADVANCE),
        })
    return out


def _insert(standard_id: int, data: dict, record_type: str) -> int:
    stamp = now()
    return db.insert("standard_stage_history", {
        "standard_id": standard_id,
        "stage_code": data["stage_code"],
        "record_type": record_type,
        "effective_date": data["effective_date"],
        "note": data.get("note"),
        "reference": data.get("reference"),
        "created_at": stamp,
        "created_by": current_user(),
        # 还没人改过：最近修改时间先与创建时间对齐，修改人留空
        "updated_at": stamp,
        "updated_by": None,
    })


def seed_initial(standard_id: int, stage_code: str, effective_date: str) -> int:
    """建档时写入第一条阶段记录，阶段历史从建档起就是完整的。"""
    return _insert(standard_id, {
        "stage_code": stage_code,
        "effective_date": effective_date,
        "note": "建档初始阶段",
        "reference": None,
    }, STAGE_ADVANCE)


def add(standard_id: int, stage_code: str, payload: dict) -> dict:
    """推进或补录一个阶段。返回新记录（含记录类型），并刷新当前阶段。"""
    data = {
        "stage_code": check_code(stage_code),
        "effective_date": (payload.get("effective_date") or "").strip() or None,
        "note": (payload.get("note") or "").strip() or None,
        "reference": (payload.get("reference") or "").strip() or None,
    }
    require(data, [("effective_date", "Effective Date 生效日期")])
    check_date(data, "effective_date", "Effective Date 生效日期")

    existing = db.query_one(
        "SELECT * FROM standard_stage_history WHERE standard_id = ? AND stage_code = ?",
        (standard_id, stage_code))
    if existing:
        raise ApiError(
            f"「{label(stage_code)}」阶段已有记录，已填写的阶段信息不可重复填写",
            field="stage_code",
            detail=f"原记录：{existing['effective_date']} · "
                   f"{STAGE_RECORD_TYPES[existing['record_type']]} · {existing['created_by']}\n"
                   f"如需更正该阶段的信息，请在时间轴上点开这一段后选「修改」")

    current = current_code(standard_id)
    if STAGE_ORDER[stage_code] == STAGE_ORDER[current]:
        raise ApiError(f"「{label(stage_code)}」已经是当前阶段", field="stage_code")

    if STAGE_ORDER[stage_code] > STAGE_ORDER[current]:
        record_type = STAGE_ADVANCE
        anchor = db.query_one(
            "SELECT effective_date FROM standard_stage_history "
            "WHERE standard_id = ? AND stage_code = ?", (standard_id, current))
        if data["effective_date"] < anchor["effective_date"]:
            raise ApiError(
                f"正常推进的生效日期不能早于当前阶段「{label(current)}」的 "
                f"{anchor['effective_date']}",
                field="effective_date",
                detail="如果要记录更早发生的阶段，请选择当前阶段之前的阶段进行补录")
    else:
        # 历史补录：真实发生时间可能早于、也可能晚于相邻阶段，不做顺序限制。
        record_type = STAGE_BACKFILL

    record_id = _insert(standard_id, data, record_type)
    recompute(standard_id)
    db.commit()
    return one(record_id)


def edit(standard_id: int, record_id: int, payload: dict) -> dict:
    """修改一条阶段记录（推进与补录一视同仁）。

    历史信息难免录错或后补依据，所以阶段记录不锁定。可改的是生效日期、
    依据与说明；阶段本身不可改写。每次修改都会刷新 updated_at / updated_by，
    首次记录的 created_at / created_by 保持不变，留痕交给这两对时间戳。
    """
    row = db.query_one(
        "SELECT * FROM standard_stage_history WHERE id = ? AND standard_id = ?",
        (record_id, standard_id))
    if not row:
        raise ApiError("阶段记录不存在", 404)

    data = {
        "effective_date": (payload.get("effective_date") or "").strip() or None,
        "note": (payload.get("note") or "").strip() or None,
        "reference": (payload.get("reference") or "").strip() or None,
    }
    require(data, [("effective_date", "Effective Date 生效日期")])
    check_date(data, "effective_date", "Effective Date 生效日期")
    data["updated_at"] = now()
    data["updated_by"] = current_user()
    db.update("standard_stage_history", record_id, data)
    db.commit()
    return one(record_id)


def one(record_id: int) -> dict:
    return _decorate(
        db.query_one("SELECT * FROM standard_stage_history WHERE id = ?", (record_id,)))
