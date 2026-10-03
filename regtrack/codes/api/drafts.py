"""草案版本、Excel 章节导入与批注。"""

import base64
import io
import json
import difflib
import re
import unicodedata

from flask import Blueprint, jsonify, request, send_file

from draft_import import read_upload

import db
import grouped
import lookups_service
from common import (
    ApiError, check_date, check_enum, clean, payload_of, require,
    stamp_create, stamp_update, current_user, now,
)
from constants import OVERALL_IMPACTS, VERSION_NAMES

bp = Blueprint("drafts", __name__, url_prefix="/api/drafts")

FIELDS = ["standard_id", "version_name", "sub_version_no", "draft_date", "file_link",
          "issued_by", "main_summary", "overall_impact", "notes"]

_DRAFT_SELECT = """
SELECT d.*, s.std_no, s.name_cn, s.stage_code,
       (SELECT COUNT(*) FROM v_current_draft_chapter ce WHERE ce.draft_id = d.id) AS clause_count
  FROM draft d JOIN standard s ON s.id = d.standard_id
"""


def _get(draft_id: int) -> dict:
    row = db.query_one(_DRAFT_SELECT + " WHERE d.id = ?", (draft_id,))
    if not row:
        raise ApiError("草案不存在", 404)
    return row


def _validate(data: dict) -> None:
    require(data, [("standard_id", "Standard"), ("version_name", "Version Name"),
                   ("sub_version_no", "Draft Sub-Version No."), ("draft_date", "Draft Date")])
    if not db.query_one("SELECT id FROM standard WHERE id = ?", (data["standard_id"],)):
        raise ApiError("所选标准不存在，请先在标准主档建档", field="standard_id")
    check_enum(data, "version_name", VERSION_NAMES, "Version Name", required=True)
    check_date(data, "draft_date", "Draft Date")
    check_enum(data, "overall_impact", OVERALL_IMPACTS, "Overall Impact")


# --------------------------------------------------------------------- #
# 草案
# --------------------------------------------------------------------- #
@bp.get("")
def list_drafts():
    where, params = ["s.archived_at IS NULL"], []
    q = (request.args.get("q") or "").strip()
    if q:
        where.append("(s.std_no LIKE ? OR s.name_cn LIKE ? OR d.version_name LIKE ?"
                     " OR COALESCE(d.main_summary,'') LIKE ?)")
        params += [f"%{q}%"] * 4
    if request.args.get("standard_id"):
        where.append("d.standard_id = ?")
        params.append(request.args["standard_id"])
    if request.args.get("impact"):
        where.append("d.overall_impact = ?")
        params.append(request.args["impact"])

    clause = " WHERE " + " AND ".join(where)
    return grouped.response(f"""
        SELECT d.standard_id AS group_key, d.*, s.std_no, s.name_cn, s.stage_code,
               (SELECT COUNT(*) FROM v_current_draft_chapter ce WHERE ce.draft_id = d.id)
                   AS clause_count
          FROM draft d
          JOIN standard s ON s.id = d.standard_id
          {clause}
    """, params)


@bp.get("/options")
def options():
    """按标准过滤的草案下拉；冗余显示版本名 + 子版本 + 日期。"""
    standard_id = request.args.get("standard_id")
    if not standard_id:
        return jsonify([])
    return jsonify(db.query(
        """SELECT id, version_name, sub_version_no, draft_date, overall_impact
             FROM draft WHERE standard_id = ?
            ORDER BY draft_date DESC, id DESC""", (standard_id,)))


@bp.get("/<int:draft_id>")
def detail(draft_id):
    draft = _get(draft_id)
    draft["chapters"] = db.query("SELECT * FROM v_current_draft_chapter WHERE draft_id = ? ORDER BY sequence", (draft_id,))
    draft["illustrations"] = db.query("""SELECT i.id, i.chapter_id, i.position, i.mime_type
        FROM draft_chapter_image i JOIN v_current_draft_chapter c ON c.id = i.chapter_id
        WHERE c.draft_id = ? ORDER BY c.sequence, i.position""", (draft_id,))
    draft["imports"] = db.query("SELECT * FROM draft_import WHERE draft_id = ? ORDER BY id DESC", (draft_id,))
    draft["annotations"] = db.query("""SELECT a.*, c.clause_no, c.title_cn
        FROM draft_annotation a LEFT JOIN draft_chapter c ON c.id = a.chapter_id
        WHERE a.draft_id = ? AND (a.chapter_id IS NULL OR EXISTS
          (SELECT 1 FROM v_current_draft_chapter cc WHERE cc.id = a.chapter_id))
        ORDER BY a.id DESC""", (draft_id,))
    draft["linked_comments"] = db.query("""SELECT id, comment_no, clause_no, status, comment_text, updated_at
        FROM comment WHERE draft_id = ? ORDER BY id""", (draft_id,))
    return jsonify(draft)


@bp.get("/<int:draft_id>/chapters/<int:chapter_id>/illustrations/<int:image_id>")
def chapter_illustration(draft_id, chapter_id, image_id):
    image = db.query_one("""SELECT i.mime_type, i.data_base64 FROM draft_chapter_image i
        JOIN v_current_draft_chapter c ON c.id = i.chapter_id
        WHERE i.id = ? AND c.id = ? AND c.draft_id = ?""", (image_id, chapter_id, draft_id))
    if not image:
        raise ApiError("附图不存在", 404)
    return send_file(io.BytesIO(base64.b64decode(image["data_base64"])),
                     mimetype=image["mime_type"], max_age=0)


@bp.post("")
def create():
    data = clean(payload_of(request), FIELDS)
    _validate(data)
    draft_id = db.insert("draft", stamp_update(stamp_create(data)))
    lookups_service.ensure_values("organization", [data.get("issued_by")])
    db.commit()
    return jsonify(_get(draft_id)), 201


@bp.put("/<int:draft_id>")
def update(draft_id):
    _get(draft_id)
    data = clean(payload_of(request), FIELDS)
    _validate({**_get(draft_id), **data})
    if data.get("standard_id") and int(data["standard_id"]) != _get(draft_id)["standard_id"]:
        if db.query_one("SELECT id FROM draft_import WHERE draft_id = ? LIMIT 1", (draft_id,)):
            raise ApiError("已有章节的草案不能更换所属标准")
    db.update("draft", draft_id, stamp_update(data))
    lookups_service.ensure_values("organization", [data.get("issued_by")])
    db.commit()
    return jsonify(_get(draft_id))


@bp.delete("/<int:draft_id>")
def remove(draft_id):
    _get(draft_id)
    db.delete("draft", draft_id)
    db.commit()
    return jsonify(ok=True)


@bp.post("/imports/read")
def read_file():
    source, chapters, _ = read_upload(request.files.get("file"))
    source["chapter_count"] = len(chapters)
    source["chapter_nos"] = [chapter["clause_no"] for chapter in chapters]
    source["incoming_comments"] = {chapter["clause_no"]: chapter["initial_comment"].strip()
                                   for chapter in chapters if chapter["initial_comment"].strip()}
    standards = db.query(
        """SELECT s.id, s.std_no, s.name_cn, s.name_en, s.stage_code, s.tc_wg,
                  s.mb_owner,
                  (SELECT COUNT(*) FROM draft d WHERE d.standard_id = s.id) AS draft_count
             FROM standard s WHERE s.archived_at IS NULL""")

    def normalized(value):
        value = unicodedata.normalize("NFKC", value or "").casefold()
        return re.sub(r"[^\w\u4e00-\u9fff]+", "", value)

    imported_name = normalized(source["standard_name"])
    ranked = []
    for standard in standards:
        names = [normalized(standard.get("name_cn")), normalized(standard.get("name_en"))]
        similarity = max((difflib.SequenceMatcher(None, imported_name, name).ratio()
                          for name in names if name), default=0)
        if similarity >= 0.5:
            standard["name_similarity"] = round(similarity, 3)
            ranked.append(standard)
    ranked.sort(key=lambda standard: (-standard["name_similarity"], standard["std_no"]))
    source["standards"] = ranked[:3]
    return jsonify(source)


@bp.post("/imports")
def import_file():
    upload = request.files.get("file")
    source, chapters, illustrations = read_upload(upload)
    try:
        target = json.loads(request.form.get("target", "{}"))
        if not isinstance(target, dict):
            raise ValueError
        draft_id = int(target["draft_id"]) if target.get("draft_id") else None
        standard_id = int(target.get("standard_id", 0))
        keep_ids = target.get("keep_annotation_ids", [])
        replace_ids = target.get("replace_annotation_ids", [])
        annotation_snapshot = target.get("annotation_snapshot", {})
        comment_snapshot = target.get("comment_snapshot", [])
        if (not isinstance(keep_ids, list) or not isinstance(replace_ids, list)
                or any(isinstance(value, bool) for value in keep_ids + replace_ids)
                or not isinstance(annotation_snapshot, dict) or not isinstance(comment_snapshot, list)):
            raise ValueError
        keep_ids = [int(value) for value in keep_ids]
        replace_ids = [int(value) for value in replace_ids]
        if len(keep_ids) != len(set(keep_ids)) or len(replace_ids) != len(set(replace_ids)):
            raise ValueError
    except (KeyError, ValueError, TypeError):
        raise ApiError("请确认所属标准与草案版本") from None
    # Serialize the replacement check with the write: another import cannot slip in.
    db.execute("BEGIN IMMEDIATE")
    try:
        standard = db.query_one("SELECT * FROM standard WHERE id = ? AND archived_at IS NULL", (standard_id,))
        if not standard:
            raise ApiError("所选标准不存在，请重新选择")
        if draft_id:
            draft = _get(draft_id)
            if draft["standard_id"] != standard_id:
                raise ApiError("草案不属于所选标准")
        else:
            data = clean(target, FIELDS)
            data["standard_id"] = standard_id
            _validate(data)
            draft_id = db.insert("draft", stamp_update(stamp_create(data)))
        latest = db.query_one("SELECT MAX(id) AS id FROM draft_import WHERE draft_id = ?", (draft_id,))["id"]
        if latest is not None and target.get("replace_import_id") != latest:
            raise ApiError("本次导入将整体替换当前章节，请刷新并确认替换及批注保留项。", 409)
        old_annotations = db.query("""SELECT a.id, a.content, c.clause_no FROM draft_annotation a
            JOIN draft_chapter c ON c.id = a.chapter_id
            WHERE a.draft_id = ? AND c.import_batch_id = ? ORDER BY c.sequence""",
            (draft_id, latest))
        linked_comments = db.query("""SELECT id, comment_no, clause_no, status, comment_text, updated_at
            FROM comment WHERE draft_id = ? ORDER BY id""", (draft_id,))
        if latest is not None and (annotation_snapshot != {str(a["id"]): a["content"] for a in old_annotations}
                                   or comment_snapshot != linked_comments):
            raise ApiError("批注或关联意见已变化，请重新确认后再导入", 409)
        incoming = {chapter["clause_no"]: chapter.get("initial_comment", "").strip()
                    for chapter in chapters}
        conflicts = {row["id"] for row in old_annotations
                     if incoming.get(row["clause_no"]) and incoming[row["clause_no"]] != row["content"].strip()}
        residuals = {row["id"] for row in old_annotations
                     if row["clause_no"] in incoming and not incoming[row["clause_no"]]}
        if not set(replace_ids).issubset(conflicts) or not set(keep_ids).issubset(residuals):
            raise ApiError("批注选择已变化，请重新读取文件和草案后再导入", 409)
        retained_by_clause = {row["clause_no"]: row["id"] for row in old_annotations
                              if row["id"] in keep_ids or
                              (row["clause_no"] in incoming and incoming[row["clause_no"]]
                               and row["id"] not in replace_ids)}
        batch_id = db.insert("draft_import", {
            "draft_id": draft_id, "filename": upload.filename.replace("\\", "/").rsplit("/", 1)[-1],
            "source_version": source["source_version"], "created_at": now(), "created_by": current_user(),
            "source_standard_no": source["standard_no"],
            "source_standard_name": source["standard_name"],
        })
        new_chapters = {}
        initial_comments = {}
        for chapter in chapters:
            row = {key: value for key, value in chapter.items() if key != "initial_comment"}
            initial_comments[chapter["clause_no"]] = chapter.get("initial_comment", "").strip()
            chapter_id = db.insert("draft_chapter", {**row, "draft_id": draft_id, "import_batch_id": batch_id})
            new_chapters[chapter["clause_no"]] = chapter_id
            for position, image in enumerate(illustrations[chapter["clause_no"]], start=1):
                db.insert("draft_chapter_image", {
                    "draft_id": draft_id, "chapter_id": chapter_id, "position": position,
                    **image,
                })
        for clause_no, annotation_id in retained_by_clause.items():
            db.update("draft_annotation", annotation_id, {"chapter_id": new_chapters[clause_no]})
        for clause_no, content in initial_comments.items():
            if content and clause_no not in retained_by_clause:
                created_at = now()
                user = current_user()
                db.insert("draft_annotation", {
                    "draft_id": draft_id, "chapter_id": new_chapters[clause_no],
                    "content": content, "created_at": created_at,
                    "created_by": user, "updated_at": created_at, "updated_by": user,
                })
        if latest is not None:
            for comment in linked_comments:
                if comment["clause_no"] and comment["clause_no"].strip() not in new_chapters:
                    db.delete("comment", comment["id"])
        db.execute("DELETE FROM draft_import WHERE draft_id = ? AND id <> ?", (draft_id, batch_id))
        db.update("draft", draft_id, stamp_update({}))
        db.commit()
    except Exception:
        db.rollback()
        raise
    return jsonify(draft_id=draft_id, import_id=batch_id, chapter_count=len(chapters)), 201


@bp.post("/<int:draft_id>/annotations")
def add_annotation(draft_id):
    _get(draft_id)
    data = payload_of(request)
    content = data.get("content")
    if not isinstance(content, str) or not content.strip():
        raise ApiError("请填写批注内容", field="content")
    chapter_id = data.get("chapter_id")
    if chapter_id is not None:
        chapter = db.query_one("SELECT id FROM v_current_draft_chapter WHERE id = ? AND draft_id = ?", (chapter_id, draft_id))
        if not chapter:
            raise ApiError("章节已被替换，请刷新后对当前章节批注", 409)
        if db.query_one("SELECT id FROM draft_annotation WHERE chapter_id = ?", (chapter_id,)):
            raise ApiError("该章节已有批注，请编辑现有批注", 409)
    annotation_id = db.insert("draft_annotation", {
        "draft_id": draft_id, "chapter_id": chapter_id, "content": content.strip(),
        "created_at": now(), "created_by": current_user(),
        "updated_at": now(), "updated_by": current_user(),
    })
    db.commit()
    return jsonify(db.query_one("SELECT * FROM draft_annotation WHERE id = ?", (annotation_id,))), 201


@bp.put("/<int:draft_id>/annotations/<int:annotation_id>")
def update_annotation(draft_id, annotation_id):
    _get(draft_id)
    annotation = db.query_one(
        "SELECT * FROM draft_annotation WHERE id = ? AND draft_id = ?",
        (annotation_id, draft_id))
    if not annotation:
        raise ApiError("批注不存在", 404)
    data = payload_of(request)
    content = data.get("content")
    if not isinstance(content, str) or not content.strip():
        raise ApiError("请填写批注内容", field="content")
    if annotation["chapter_id"] is not None and not db.query_one(
            "SELECT id FROM v_current_draft_chapter WHERE id = ? AND draft_id = ?",
            (annotation["chapter_id"], draft_id)):
        raise ApiError("章节已被替换，请刷新后编辑当前批注", 409)
    db.update("draft_annotation", annotation_id, {
        "content": content.strip(), "updated_at": now(), "updated_by": current_user(),
    })
    db.commit()
    return jsonify(db.query_one("SELECT * FROM draft_annotation WHERE id = ?", (annotation_id,)))
