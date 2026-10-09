"""标准生命周期回顾：按阶段归档会议、草案和意见。"""

import io
import re

from flask import Blueprint, jsonify, render_template, send_file

import db
import stages
import status
from api import actions as actions_api
from api import drafts as drafts_api
from api import standards as standards_api
from common import now, today
from constants import STAGE_ORDER, TERMINAL_STAGE, VERSION_STAGES

bp = Blueprint("lifecycle", __name__, url_prefix="/api/standards")


def _lifecycle_stages(standard: dict) -> list[dict]:
    """已记录阶段取自历史；始终保留预研入口，未登记时不虚构日期。"""
    history = stages.records(standard["id"])
    history.sort(key=lambda r: (r["effective_date"], STAGE_ORDER[r["stage_code"]]))
    timeline = []
    for index, row in enumerate(history):
        following = history[index + 1] if index + 1 < len(history) else None
        timeline.append({
            "code": row["stage_code"],
            "name": row["stage_label"],
            "state": "done" if following else "current",
            "start": row["effective_date"],
            "end": following["effective_date"] if following else None,
            "note": row["note"],
            "record_type": row["record_type"],
            "record_type_label": row["record_type_label"],
            # 阶段记录可修改，导出时把首次记录与最近修改一并带上
            "created_at": row["created_at"],
            "created_by": row["created_by"],
            "updated_at": row["updated_at"],
            "updated_by": row["updated_by"],
            "modified": row["modified"],
        })

    current_rank = STAGE_ORDER[standard["stage_code"]]
    recorded = {row["stage_code"] for row in history}
    if "PRE_RESEARCH" not in recorded:
        timeline.insert(0, {
            "code": "PRE_RESEARCH", "name": stages.label("PRE_RESEARCH"),
            "state": "unrecorded", "start": None, "end": None, "note": None,
            "record_type": None, "record_type_label": None,
            "created_at": None, "created_by": None,
            "updated_at": None, "updated_by": None, "modified": False,
        })
    timeline += [
        {"code": code, "name": stages.label(code), "state": "future",
         "start": None, "end": None, "note": None,
         "record_type": None, "record_type_label": None,
         "created_at": None, "created_by": None,
         "updated_at": None, "updated_by": None, "modified": False}
        for code, rank in STAGE_ORDER.items()
        if rank > current_rank and code not in recorded and code != TERMINAL_STAGE
    ]
    for stage in timeline:
        stage.update(meetings=[], drafts=[], comments=[], actions=[])
    return timeline


def _stage_for(timeline: list[dict], day: str, preferred: str | None = None) -> dict:
    """优先归入 preferred 阶段（须已经历）；否则归入 day 所在的已经历阶段区间。"""
    reached = [s for s in timeline if s["state"] in ("done", "current")]
    for stage in reached:
        if stage["code"] == preferred:
            return stage
    hit = reached[0]  # 早于第一条阶段记录的日期归入第一个阶段
    for stage in reached:
        if stage["start"] <= day:
            hit = stage
    return hit


def payload(standard_id: int, full: bool) -> dict:
    """full=False 供页面展示；full=True 供知识库导出，附带章节、状态历史与事项。"""
    standard = standards_api._get(standard_id)
    timeline = _lifecycle_stages(standard)

    meetings = db.query(
        """SELECT m.*, ms.note AS standard_note
             FROM meeting m JOIN meeting_standard ms ON ms.meeting_id = m.id
            WHERE ms.standard_id = ? ORDER BY m.meeting_date, m.id""", (standard_id,))
    for meeting in meetings:
        _stage_for(timeline, meeting["meeting_date"])["meetings"].append(meeting)

    drafts = db.query(
        """SELECT d.*, (SELECT COUNT(*) FROM v_current_draft_chapter ce WHERE ce.draft_id = d.id)
                  AS clause_count
             FROM draft d WHERE d.standard_id = ?
            ORDER BY d.draft_date, d.id""", (standard_id,))
    draft_stage = {}
    for draft in drafts:
        stage = _stage_for(timeline, draft["draft_date"], VERSION_STAGES[draft["version_name"]])
        draft_stage[draft["id"]] = stage
        if full:
            draft["clauses"] = db.query(
                "SELECT * FROM v_current_draft_chapter WHERE draft_id = ? ORDER BY sequence",
                (draft["id"],))
        stage["drafts"].append(draft)

    comments = db.query(
        """SELECT c.*, d.version_name, d.sub_version_no
             FROM comment c LEFT JOIN draft d ON d.id = c.draft_id
            WHERE c.standard_id = ?
            ORDER BY COALESCE(c.submission_date, substr(c.created_at, 1, 10)), c.id""",
        (standard_id,))
    for comment in comments:
        day = comment["submission_date"] or comment["created_at"][:10]
        stage = draft_stage.get(comment["draft_id"]) or _stage_for(timeline, day)
        if full:
            comment["status_history"] = status.history("comment", comment["id"], "status")
        stage["comments"].append(comment)

    if full:
        meeting_stage = {}
        for stage in timeline:
            for meeting in stage["meetings"]:
                meeting_stage[meeting["id"]] = stage
        rows = db.query(
            actions_api._SELECT + " WHERE a.standard_id = ? ORDER BY a.created_at, a.id",
            (standard_id,))
        for action in rows:
            stage = (draft_stage.get(action["draft_id"])
                     or meeting_stage.get(action["meeting_id"])
                     or _stage_for(timeline, action["created_at"][:10]))
            action["recipients"] = actions_api._recipients(action["id"])
            action["status_history"] = status.history(
                "action_item", action["id"], "current_status")
            stage["actions"].append(action)

    return {"standard": standard, "stages": timeline}


@bp.get("/<int:standard_id>/lifecycle")
def standard_lifecycle(standard_id):
    return jsonify(payload(standard_id, full=False))


def md_block(value) -> str:
    """多行文本转为 Markdown 引用块，保留原有换行。"""
    return "\n".join("> " + line for line in str(value).strip().splitlines())


def md_inline(value) -> str:
    """表格单元格与行内文本：压成一行并转义竖线。"""
    return " ".join(str(value).split()).replace("|", "\\|")


@bp.get("/<int:standard_id>/lifecycle.md")
def export_lifecycle(standard_id):
    data = payload(standard_id, full=True)
    text = render_template("exports/lifecycle.md", exported_at=now(), **data)
    std_no = data["standard"]["std_no"] or data["standard"]["name_cn"]
    safe_no = re.sub(r'[\\/:*?"<>|\s]+', "_", std_no).strip("_")
    return send_file(
        io.BytesIO(text.encode("utf-8")),
        mimetype="text/markdown; charset=utf-8",
        as_attachment=True,
        download_name=f"{safe_no}_生命周期回顾_{today()}.md",
    )
