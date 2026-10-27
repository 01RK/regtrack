"""意见矩阵 · 意见导入与导出（单版本意见批注，按草案版本交换 Excel）。"""

import re

from flask import Blueprint, jsonify, request, send_file

import comment_history
import comment_workbook
import db
import i18n
import opinion_service
from common import ApiError, current_user, now, today
from constants import IMPORTED_ANNOTATION_TYPE

bp = Blueprint("comment_exchange", __name__, url_prefix="/api/comments/exchange")

XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _t(zh: str, en: str) -> str:
    return en if i18n.current() == "en" else zh


def _draft(draft_id) -> dict:
    row = db.query_one("""SELECT d.id, d.version_name, d.sub_version_no, s.std_no, s.name_cn
        FROM draft d INNER JOIN standard s ON s.id = d.standard_id
        WHERE d.id = %s AND s.archived_at IS NULL""", (draft_id,))
    if not row:
        raise ApiError(_t("请选择有效的标准和草案版本", "Select a valid standard and draft version"), field="draft_id")
    return row


def _chapters(draft_id: int) -> dict:
    return {c["clause_no"]: c for c in db.query(
        "SELECT id, clause_no, content_cn, sequence FROM draft_chapter WHERE draft_id = %s",
        (draft_id,))}


def _filename(draft: dict, stamp: str) -> str:
    name = f"{draft['std_no'] or draft['name_cn']}_{draft['version_name']}v{draft['sub_version_no']}_意见导出_{stamp}.xlsx"
    return re.sub(r'[\\/:*?"<>|]+', "-", name)


@bp.get("/template")
def template():
    return send_file(comment_workbook.build([]), mimetype=XLSX, as_attachment=True,
                     download_name="意见导入模板.xlsx", max_age=0)


@bp.get("/export")
def export():
    draft = _draft(request.args.get("draft_id", type=int))
    chapters = _chapters(draft["id"])
    comments = db.query("""SELECT clause_no, comment_text, status FROM comment
        WHERE source_kind = 'single' AND draft_id = %s ORDER BY id""", (draft["id"],))
    # 整份草案意见在前，其余按当前章节顺序；章节已不存在的意见排在最后。
    unmatched = len(chapters) + 1
    comments.sort(key=lambda c: -1 if not c["clause_no"] else
                  chapters[c["clause_no"]]["sequence"] if c["clause_no"] in chapters else unmatched)
    rows = [(c["clause_no"] or "",
             (chapters[c["clause_no"]]["content_cn"] or "") if c["clause_no"] in chapters else "",
             c["comment_text"], c["status"]) for c in comments]
    return send_file(comment_workbook.build(rows), mimetype=XLSX, as_attachment=True,
                     download_name=_filename(draft, today().replace("-", "")), max_age=0)


@bp.post("/import")
def import_file():
    draft = _draft(request.form.get("draft_id", type=int))
    rows = comment_workbook.read(request.files.get("file"), _t)
    try:
        chapters = _chapters(draft["id"])
        unknown = [row for row in rows if row["clause_no"] and row["clause_no"] not in chapters]
        if unknown:
            raise ApiError(
                _t(f"{len(unknown)} 条意见的章条编号在该草案当前章节中不存在，未写入任何数据",
                   f"{len(unknown)} opinion(s) reference clause numbers that are not in this draft. Nothing was imported"),
                detail="\n".join(_t(f"第 {row['row']} 行：{row['clause_no']}", f"Row {row['row']}: {row['clause_no']}")
                                 for row in unknown))
        existing = {(c["clause_no"] or "", c["comment_text"].strip()) for c in db.query(
            "SELECT clause_no, comment_text FROM comment WHERE source_kind = 'single' AND draft_id = %s",
            (draft["id"],))}
        user, created, skipped = current_user(), [], []
        for row in rows:
            key = (row["clause_no"], row["text"])
            if key in existing:
                skipped.append(row["row"])
                continue
            existing.add(key)
            stamp = now()
            annotation_id = db.insert("draft_annotation", {
                "draft_id": draft["id"],
                "chapter_id": chapters[row["clause_no"]]["id"] if row["clause_no"] else None,
                "annotation_type": IMPORTED_ANNOTATION_TYPE, "content": row["text"],
                "created_at": stamp, "created_by": user, "updated_at": stamp, "updated_by": user,
            })
            opinion_service.sync_annotation(annotation_id, 0 if row["status"] == "Draft" else 1)
            comment = db.query_one("SELECT id, comment_no FROM comment WHERE source_annotation_id = %s",
                                   (annotation_id,))
            if row["status"] not in ("Draft", "Submitted"):
                comment_history.append(comment["id"], {"new_value": row["status"], "effective_date": today()})
            created.append(comment["comment_no"])
        db.commit()
    except Exception:
        db.rollback()
        raise
    return jsonify(created=created, skipped_rows=skipped), 201
