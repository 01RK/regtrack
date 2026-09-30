"""3. WG Meeting 工作组会议 + ◆ 涉及标准。"""

from flask import Blueprint, jsonify, request

import db
import lookups_service
from common import (
    ApiError, check_date, check_enum, clean, paginate, payload_of, require,
    stamp_create, stamp_update,
)
from constants import MEETING_TYPES

bp = Blueprint("meetings", __name__, url_prefix="/api/meetings")

FIELDS = ["title", "meeting_date", "meeting_type", "organizer", "participants",
          "key_discussions", "overall_conclusion", "material_link", "next_meeting_date"]


def _get(meeting_id: int) -> dict:
    row = db.query_one("SELECT * FROM meeting WHERE id = ?", (meeting_id,))
    if not row:
        raise ApiError("会议不存在", 404)
    return row


def _standards(meeting_id: int) -> list[dict]:
    return db.query(
        """SELECT s.id, s.std_no, s.name_cn, s.stage_code, s.risk_level, s.mb_owner,
                  ms.note,
                  (SELECT COUNT(*) FROM action_item a
                    WHERE a.meeting_id = ? AND a.standard_id = s.id) AS action_count
             FROM meeting_standard ms JOIN standard s ON s.id = ms.standard_id
            WHERE ms.meeting_id = ? ORDER BY s.std_no""", (meeting_id, meeting_id))


def _validate(data: dict) -> None:
    require(data, [("title", "Meeting Title"), ("meeting_date", "Meeting Date")])
    check_date(data, "meeting_date", "Meeting Date")
    check_date(data, "next_meeting_date", "Next Meeting Date")
    check_enum(data, "meeting_type", MEETING_TYPES, "Meeting Type")


def _standard_ids(payload: dict) -> list[int] | None:
    """解析请求里的涉及标准列表；未提交该字段时返回 None，表示不改动现有关联。"""
    if "standard_ids" not in payload:
        return None
    raw = payload["standard_ids"]
    if not isinstance(raw, list):
        raise ApiError("「涉及标准」应为标准 id 列表", field="standard_ids",
                       detail=f"实际收到 {type(raw).__name__}")
    ids = []
    for value in raw:
        try:
            sid = int(value)
        except (TypeError, ValueError):
            raise ApiError(f"标准 id 不合法：{value}", field="standard_ids") from None
        if sid not in ids:
            ids.append(sid)
    missing = [sid for sid in ids
               if not db.query_one("SELECT id FROM standard WHERE id = ?", (sid,))]
    if missing:
        raise ApiError("涉及标准中有不存在的记录", field="standard_ids",
                       detail="不存在的标准 id：" + ", ".join(map(str, missing)))
    return ids


@bp.get("")
def list_meetings():
    where, params = [], []
    q = (request.args.get("q") or "").strip()
    if q:
        where.append("(m.title LIKE ? OR m.meeting_no LIKE ? OR COALESCE(m.organizer,'') LIKE ?"
                     " OR COALESCE(m.key_discussions,'') LIKE ?)")
        params += [f"%{q}%"] * 4
    if request.args.get("type"):
        where.append("m.meeting_type = ?")
        params.append(request.args["type"])
    if request.args.get("standard_id"):
        where.append("EXISTS (SELECT 1 FROM meeting_standard ms "
                     " WHERE ms.meeting_id = m.id AND ms.standard_id = ?)")
        params.append(request.args["standard_id"])

    clause = (" WHERE " + " AND ".join(where)) if where else ""
    total = db.query_one(f"SELECT COUNT(*) c FROM meeting m{clause}", params)["c"]
    limit, offset = paginate(request.args)
    rows = db.query(
        f"""SELECT m.*,
                   (SELECT COUNT(*) FROM meeting_standard ms WHERE ms.meeting_id = m.id)
                       AS standard_count,
                   (SELECT COUNT(*) FROM action_item a WHERE a.meeting_id = m.id)
                       AS action_count
              FROM meeting m{clause}
             ORDER BY m.meeting_date DESC, m.id DESC LIMIT ? OFFSET ?""",
        params + [limit, offset])
    for r in rows:
        r["standards"] = _standards(r["id"])
    return jsonify(total=total, items=rows)


@bp.get("/options")
def options():
    q = (request.args.get("q") or "").strip()
    params, clause = [], ""
    if q:
        clause = " WHERE title LIKE ? OR meeting_no LIKE ?"
        params = [f"%{q}%"] * 2
    return jsonify(db.query(
        f"""SELECT id, meeting_no, title, meeting_date, meeting_type
              FROM meeting{clause} ORDER BY meeting_date DESC LIMIT 50""", params))


@bp.get("/<int:meeting_id>")
def detail(meeting_id):
    meeting = _get(meeting_id)
    meeting["standards"] = _standards(meeting_id)
    meeting["actions"] = db.query(
        """SELECT a.id, a.item_no, a.item_type, a.title, a.current_status, a.standard_id,
                  s.std_no, s.name_cn
             FROM action_item a LEFT JOIN standard s ON s.id = a.standard_id
            WHERE a.meeting_id = ? ORDER BY a.id DESC""", (meeting_id,))
    return jsonify(meeting)


@bp.post("")
def create():
    payload = payload_of(request)
    data = clean(payload, FIELDS)
    _validate(data)
    standard_ids = _standard_ids(payload)
    data["meeting_no"] = db.next_serial("meeting", "meeting_no", "MTG",
                                        data["meeting_date"][:4])
    meeting_id = db.insert("meeting", stamp_update(stamp_create(data)))
    lookups_service.ensure_values("organization", [data.get("organizer")])
    _replace_standards(meeting_id, standard_ids)
    db.commit()
    return jsonify(detail_payload(meeting_id)), 201


@bp.put("/<int:meeting_id>")
def update(meeting_id):
    _get(meeting_id)
    payload = payload_of(request)
    data = clean(payload, FIELDS)
    _validate({**_get(meeting_id), **data})
    standard_ids = _standard_ids(payload)
    db.update("meeting", meeting_id, stamp_update(data))
    lookups_service.ensure_values("organization", [data.get("organizer")])
    _replace_standards(meeting_id, standard_ids, _wants_drop_notes(payload))
    db.commit()
    return jsonify(detail_payload(meeting_id))


@bp.delete("/<int:meeting_id>")
def remove(meeting_id):
    _get(meeting_id)
    db.delete("meeting", meeting_id)
    db.commit()
    return jsonify(ok=True)


def detail_payload(meeting_id: int) -> dict:
    meeting = _get(meeting_id)
    meeting["standards"] = _standards(meeting_id)
    return meeting


# --------------------------------------------------------------------- #
# ◆ 涉及标准
#
# 桥表 meeting_standard 的 note 是「这一项标准在这场会上的批注」：一场会讨论
# 好几项标准时，每项的议论各记各的。note 只属于这条关联，取消挂载就没有了，
# 所以凡是会删掉非空 note 的操作都要求先确认（drop_notes），
# 避免顺手一点就把写好的批注抹掉。
# --------------------------------------------------------------------- #
DROP_NOTE_WARNING = "您正在取消挂载一份批注过 Note 的标准，如确认移除，Note 也将丢失。"


def _wants_drop_notes(payload: dict) -> bool:
    flag = payload.get("drop_notes", request.args.get("drop_notes"))
    return str(flag).lower() in ("1", "true", "yes")


def _noted(meeting_id: int, standard_ids: list[int] | None = None) -> list[str]:
    """本会议中写过批注、且不在保留列表里的标准编号。"""
    sql = ("""SELECT s.std_no FROM meeting_standard ms JOIN standard s ON s.id = ms.standard_id
               WHERE ms.meeting_id = ? AND ms.note IS NOT NULL AND TRIM(ms.note) <> ''""")
    params = [meeting_id]
    if standard_ids is not None:
        sql += f" AND ms.standard_id NOT IN ({', '.join('?' for _ in standard_ids)})"
        params += standard_ids
    return [r["std_no"] for r in db.query(sql + " ORDER BY s.std_no", params)]


def _replace_standards(meeting_id: int, standard_ids: list[int] | None,
                       drop_notes: bool = False) -> None:
    """按提交的列表重设本会议涉及的标准；保留下来的关联不丢批注。"""
    if standard_ids is None:
        return
    losing = _noted(meeting_id, standard_ids)
    if losing and not drop_notes:
        raise ApiError(DROP_NOTE_WARNING, field="standard_ids",
                       detail="涉及：" + "、".join(losing))
    # NOT IN () 在 SQLite 中为合法写法，空列表即清空本会议的全部关联
    keep = ", ".join("?" for _ in standard_ids)
    db.execute(f"DELETE FROM meeting_standard WHERE meeting_id = ? "
               f"AND standard_id NOT IN ({keep})", [meeting_id] + standard_ids)
    for sid in standard_ids:
        db.execute("INSERT OR IGNORE INTO meeting_standard (meeting_id, standard_id) "
                   "VALUES (?, ?)", (meeting_id, sid))


@bp.post("/<int:meeting_id>/standards")
def attach_standard(meeting_id):
    """给会议追加一个涉及标准。会议可挂多个标准，不会影响其它会议的关联。"""
    _get(meeting_id)
    payload = payload_of(request)
    sid = payload.get("standard_id")
    if not sid:
        raise ApiError("请选择标准", field="standard_id")
    std = db.query_one("SELECT id, std_no FROM standard WHERE id = ?", (sid,))
    if not std:
        raise ApiError("标准不存在", field="standard_id")
    if db.query_one("SELECT 1 FROM meeting_standard WHERE meeting_id = ? AND standard_id = ?",
                    (meeting_id, sid)):
        raise ApiError(f"{std['std_no']} 已经挂在这场会议上", field="standard_id")
    db.insert("meeting_standard", {
        "meeting_id": meeting_id, "standard_id": sid,
        "note": (payload.get("note") or "").strip() or None})
    db.commit()
    return jsonify(_standards(meeting_id)), 201


@bp.put("/<int:meeting_id>/standards/<int:standard_id>")
def update_standard_note(meeting_id, standard_id):
    """编辑某一项标准在本次会议上的批注。"""
    _get(meeting_id)
    link = db.query_one(
        "SELECT 1 FROM meeting_standard WHERE meeting_id = ? AND standard_id = ?",
        (meeting_id, standard_id))
    if not link:
        raise ApiError("这项标准没有挂在本次会议上", 404, field="standard_id")
    note = (payload_of(request).get("note") or "").strip() or None
    db.execute("UPDATE meeting_standard SET note = ? WHERE meeting_id = ? AND standard_id = ?",
               (note, meeting_id, standard_id))
    db.commit()
    return jsonify(_standards(meeting_id))


@bp.delete("/<int:meeting_id>/standards/<int:standard_id>")
def detach_standard(meeting_id, standard_id):
    link = db.query_one(
        """SELECT ms.note, s.std_no FROM meeting_standard ms
                  JOIN standard s ON s.id = ms.standard_id
            WHERE ms.meeting_id = ? AND ms.standard_id = ?""", (meeting_id, standard_id))
    if link and (link["note"] or "").strip() and not _wants_drop_notes(payload_of(request)):
        raise ApiError(DROP_NOTE_WARNING, field="note", detail=f"涉及：{link['std_no']}")
    db.execute("DELETE FROM meeting_standard WHERE meeting_id = ? AND standard_id = ?",
               (meeting_id, standard_id))
    db.commit()
    return jsonify(_standards(meeting_id))
