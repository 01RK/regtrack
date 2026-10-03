"""固定取值下发与首页统计。"""

from datetime import date

from flask import Blueprint, jsonify, request

import db
from common import current_user, today
from constants import ACTION_OPEN_STATUSES, STAGE_LABELS, STAGES, meta_payload

bp = Blueprint("meta", __name__, url_prefix="/api")

OPEN_MARKS = ", ".join("?" * len(ACTION_OPEN_STATUSES))


@bp.get("/meta")
def meta():
    return jsonify(meta_payload())


# --------------------------------------------------------------------- #
# 登记概览的两块清单
#
# 两块都按「人」过滤，默认是顶栏选定的当前操作人——同事打开总览，最想先看到
# 自己手上的事。参数缺省时用当前操作人；显式传空串表示「不限」，
# 这样「没传」和「选了不限」是两种不同的意思。
# --------------------------------------------------------------------- #
def _person_arg(name: str) -> str:
    value = request.args.get(name)
    return current_user() if value is None else value.strip()


def _people() -> list[str]:
    """筛选下拉的候选：登记过记录的人，加上人员字典里的人。"""
    rows = db.query(
        """SELECT DISTINCT name FROM (
               SELECT created_by AS name FROM standard
               UNION ALL SELECT created_by FROM draft
               UNION ALL SELECT created_by FROM meeting
               UNION ALL SELECT created_by FROM action_item
               UNION ALL SELECT created_by FROM comment
               UNION ALL SELECT value FROM lookup_value WHERE category = 'person')
            WHERE name IS NOT NULL AND name <> '' ORDER BY name""")
    names = [r["name"] for r in rows]
    me = current_user()
    if me and me not in names:
        names.insert(0, me)
    return names


def open_actions(person: str) -> list[dict]:
    """在办事项 · 按截止日期。person 为空表示不限登记人。"""
    where = [f"a.current_status IN ({OPEN_MARKS})",
             "COALESCE(a.submission_due_date, a.check_due_date, a.target_date) IS NOT NULL",
             "(a.standard_id IS NULL OR s.archived_at IS NULL)"]
    params = list(ACTION_OPEN_STATUSES)
    if person:
        where.append("a.created_by = ?")
        params.append(person)
    return db.query(
        f"""SELECT a.id, a.item_no, a.item_type, a.title, a.current_status, a.priority,
                   a.created_by, s.std_no, s.name_cn,
                   COALESCE(a.submission_due_date, a.check_due_date, a.target_date) AS due_date
              FROM action_item a
              LEFT JOIN standard s ON s.id = a.standard_id
             WHERE {" AND ".join(where)}
             ORDER BY due_date ASC LIMIT 20""", params)


def attended_meetings(person: str, date_from: str, date_to: str) -> dict:
    """某人在一段时间内参加的工作组会议。

    「参加」按两条线认定：会议的参会人员里写了这个人，或者这场会是他登记的。
    参会人员是自由文本（常写成「张伟、李静」或一串英文名），所以用包含匹配；
    登记人是精确值。两者取并集，既不漏掉别人代登记的会，
    也不漏掉参会名单里只写了名字的会。
    """
    where = ["m.meeting_date >= ?", "m.meeting_date <= ?"]
    params = [date_from, date_to]
    if person:
        where.append("(m.created_by = ? OR COALESCE(m.participants, '') LIKE ?)")
        params += [person, f"%{person}%"]
    clause = " WHERE " + " AND ".join(where)
    total = db.query_one(f"SELECT COUNT(*) c FROM meeting m{clause}", params)["c"]
    rows = db.query(
        f"""SELECT m.id, m.meeting_no, m.title, m.meeting_date, m.meeting_type,
                   m.organizer, m.participants, m.created_by,
                   (SELECT COUNT(*) FROM meeting_standard ms WHERE ms.meeting_id = m.id)
                       AS standard_count,
                   (SELECT GROUP_CONCAT(s.std_no, ' · ')
                      FROM meeting_standard ms JOIN standard s ON s.id = ms.standard_id
                     WHERE ms.meeting_id = m.id) AS standards
              FROM meeting m{clause}
             ORDER BY m.meeting_date DESC, m.id DESC LIMIT 20""", params)
    return {"total": total, "items": rows, "person": person,
            "from": date_from, "to": date_to}


def _meeting_range() -> tuple[str, str]:
    """默认区间：系统日期所在年份的 1 月 1 日到今天。"""
    date_from = (request.args.get("from") or "").strip() or f"{date.today().year}-01-01"
    date_to = (request.args.get("to") or "").strip() or today()
    return date_from, date_to


@bp.get("/dashboard/due-actions")
def due_actions():
    person = _person_arg("person")
    return jsonify(person=person, items=open_actions(person))


@bp.get("/dashboard/meetings")
def dashboard_meetings():
    date_from, date_to = _meeting_range()
    return jsonify(attended_meetings(_person_arg("person"), date_from, date_to))


@bp.get("/dashboard")
def dashboard():
    # 归档标准不计入总览，但数据仍在库里可查
    live = " WHERE archived_at IS NULL"
    counts = {
        "standards": db.query_one(f"SELECT COUNT(*) c FROM standard{live}")["c"],
        "archived_standards": db.query_one(
            "SELECT COUNT(*) c FROM standard WHERE archived_at IS NOT NULL")["c"],
        "drafts": db.query_one("SELECT COUNT(*) c FROM draft")["c"],
        "clauses": db.query_one("SELECT COUNT(*) c FROM v_current_draft_chapter")["c"],
        "meetings": db.query_one("SELECT COUNT(*) c FROM meeting")["c"],
        "comments": db.query_one("SELECT COUNT(*) c FROM comment")["c"],
        "actions": db.query_one("SELECT COUNT(*) c FROM action_item")["c"],
        "open_actions": db.query_one(
            f"SELECT COUNT(*) c FROM action_item WHERE current_status IN ({OPEN_MARKS})",
            ACTION_OPEN_STATUSES,
        )["c"],
    }
    by_stage_rows = {
        r["stage_code"]: r["c"] for r in db.query(
            f"SELECT stage_code, COUNT(*) AS c FROM standard{live} GROUP BY stage_code")}
    action_person = _person_arg("action_person")
    meeting_person = _person_arg("meeting_person")
    date_from, date_to = _meeting_range()
    return jsonify({
        "counts": counts,
        "people": _people(),
        # 九个阶段全部输出（含 0 条的），横向柱图据此画出完整的生命周期标尺
        "by_stage": [{"code": s["code"], "name": STAGE_LABELS[s["code"]],
                      "c": by_stage_rows.get(s["code"], 0)}
                     for s in STAGES],
        "comment_status": db.query(
            "SELECT status AS name, COUNT(*) AS c FROM comment "
            " GROUP BY status ORDER BY c DESC"),
        "due_actions": {"person": action_person, "items": open_actions(action_person)},
        "meetings": attended_meetings(meeting_person, date_from, date_to),
    })
