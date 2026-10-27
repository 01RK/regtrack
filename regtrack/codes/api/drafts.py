"""草案版本、Excel 章节导入与批注。"""

import json
import difflib
import re
import unicodedata

from flask import Blueprint, jsonify, request

from draft_import import read_upload

import db
import files
import comparison_service
import grouped
import opinion_service
import lookups_service
from common import (
    ApiError, check_date, check_enum, clean, payload_of, record_id, require,
    stamp_create, stamp_update, current_user, now,
)
from constants import ANNOTATION_TYPES, IMPORTED_ANNOTATION_TYPE, OVERALL_IMPACTS, VERSION_NAMES

bp = Blueprint("drafts", __name__, url_prefix="/api/drafts")

FIELDS = ["standard_id", "version_name", "sub_version_no", "draft_date", "file_link",
          "issued_by", "main_summary", "overall_impact", "notes"]

_DRAFT_SELECT = """
SELECT d.*, s.std_no, s.name_cn, s.stage_code,
       (SELECT COUNT(*) FROM draft_chapter ce WHERE ce.draft_id = d.id) AS clause_count
  FROM draft d INNER JOIN standard s ON s.id = d.standard_id
"""


def _get(draft_id: int) -> dict:
    row = db.query_one(_DRAFT_SELECT + " WHERE d.id = %s", (draft_id,))
    if not row:
        raise ApiError("草案不存在", 404)
    return row


def _validate(data: dict) -> None:
    require(data, [("standard_id", "Standard"), ("version_name", "Version Name"),
                   ("sub_version_no", "Draft Sub-Version No."), ("draft_date", "Draft Date")])
    if not db.query_one("SELECT id FROM standard WHERE id = %s", (data["standard_id"],)):
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
        where.append("(s.std_no ILIKE %s OR s.name_cn ILIKE %s OR d.version_name ILIKE %s"
                     " OR d.main_summary ILIKE %s)")
        params += [db.contains(q)] * 4
    standard_id = request.args.get("standard_id", type=int)
    if standard_id:
        where.append("d.standard_id = %s")
        params.append(standard_id)
    if request.args.get("impact"):
        where.append("d.overall_impact = %s")
        params.append(request.args["impact"])

    return grouped.response(db.query(_DRAFT_SELECT + " WHERE " + " AND ".join(where), params),
                            max_group_size=10)


@bp.get("/options")
def options():
    """按标准过滤的草案下拉；冗余显示版本名 + 子版本 + 日期。"""
    standard_id = request.args.get("standard_id", type=int)
    if not standard_id:
        return jsonify([])
    return jsonify(db.query(
        """SELECT id, version_name, sub_version_no, draft_date, overall_impact
             FROM draft WHERE standard_id = %s
            ORDER BY draft_date DESC, id DESC""", (standard_id,)))


def annotations(draft_id: int) -> list[dict]:
    """当前章节及整份草案的批注，阅读页面与生命周期导出共用。

    草案只保留当前导入的章节，章节批注随旧章节级联删除，因此这里取到的都是当前批注。
    """
    rows = db.query("""SELECT a.*, c.clause_no, c.title_cn,
        (SELECT cm.id FROM comment cm WHERE cm.source_annotation_id = a.id) AS formal_comment_id,
        (SELECT cm.needs_follow_up FROM comment cm WHERE cm.source_annotation_id = a.id) AS comment_follow_up
        FROM draft_annotation a LEFT JOIN draft_chapter c ON c.id = a.chapter_id
        WHERE a.draft_id = %s
        ORDER BY a.id DESC""", (draft_id,))
    for row in rows:
        row["needs_follow_up"] = row.pop("comment_follow_up")
    return rows


def _linked_comments(draft_id: int) -> list[dict]:
    return db.query("""SELECT id, comment_no, clause_no, status, comment_text, updated_at
        FROM comment WHERE source_kind = 'single' AND draft_id = %s ORDER BY id""", (draft_id,))


@bp.get("/<int:draft_id>")
def detail(draft_id):
    draft = _get(draft_id)
    draft["chapters"] = db.query("SELECT * FROM draft_chapter WHERE draft_id = %s ORDER BY sequence", (draft_id,))
    draft["illustrations"] = db.query("""SELECT i.id, i.chapter_id, i.position, i.mime_type, i.file_path
        FROM draft_chapter_image i INNER JOIN draft_chapter c ON c.id = i.chapter_id
        WHERE c.draft_id = %s ORDER BY c.sequence, i.position""", (draft_id,))
    for image in draft["illustrations"]:
        image["url"] = files.url(image.pop("file_path"))
    draft["imports"] = db.query("SELECT * FROM draft_import WHERE draft_id = %s ORDER BY id DESC", (draft_id,))
    draft["annotations"] = annotations(draft_id)
    draft["linked_comments"] = _linked_comments(draft_id)
    return jsonify(draft)


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
    if any(k in data and data[k] != _get(draft_id)[k] for k in ("standard_id", "draft_date")):
        comparison_service.assert_source_unbound(draft_id)
    if data.get("standard_id") and int(data["standard_id"]) != _get(draft_id)["standard_id"]:
        if db.query_one("SELECT id FROM draft_import WHERE draft_id = %s", (draft_id,)):
            raise ApiError("已有章节的草案不能更换所属标准")
        if db.query_one("SELECT id FROM comment WHERE draft_id=%s OR before_draft_id=%s OR after_draft_id=%s", (draft_id, draft_id, draft_id)):
            raise ApiError("已有正式意见关联的草案不能更换所属标准")
    db.update("draft", draft_id, stamp_update(data))
    lookups_service.ensure_values("organization", [data.get("issued_by")])
    db.commit()
    return jsonify(_get(draft_id))


@bp.get("/<int:draft_id>/deletion")
def deletion_impact(draft_id):
    """删除草案前的影响范围，供确认框列出。"""
    _get(draft_id)
    return jsonify(db.query_one("""SELECT
          (SELECT COUNT(*) FROM draft_chapter WHERE draft_id = %s) AS chapters,
          (SELECT COUNT(*) FROM draft_chapter_image WHERE draft_id = %s) AS images,
          (SELECT COUNT(*) FROM draft_annotation WHERE draft_id = %s) AS annotations,
          (SELECT COUNT(*) FROM comment WHERE draft_id = %s OR before_draft_id = %s OR after_draft_id = %s) AS comments,
          (SELECT COUNT(*) FROM action_item WHERE draft_id = %s) AS actions,
          (SELECT COUNT(*) FROM draft_comparison WHERE before_draft_id = %s OR after_draft_id = %s) AS comparisons
          FROM app_meta""", (draft_id,) * 9))


@bp.delete("/<int:draft_id>")
def remove(draft_id):
    _get(draft_id)
    if db.query_one("SELECT id FROM draft_comparison WHERE before_draft_id = %s OR after_draft_id = %s",
                    (draft_id, draft_id)):
        raise ApiError("这份草案已用于标准比对，请先在比对结果页删除比对，再删除草案", 409)
    # 章节、附图记录、批注与相关意见随草案级联删除；关联事项保留并解除草案关联。
    # 附图文件在提交成功后再删除。
    files.remove_after_commit(_image_files("draft_id = %s", (draft_id,)))
    db.delete("draft", draft_id)
    db.commit()
    return jsonify(ok=True)


def _image_files(where: str, params) -> list[str]:
    return [row["file_path"] for row in db.query(
        f"SELECT file_path FROM draft_chapter_image WHERE {where}", params)]


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
    ranked.sort(key=lambda standard: (-standard["name_similarity"], standard["std_no"] or ""))
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
    # 先把全部附图写进附件文件夹，这一步不碰数据库；数据库事务只写记录，尽快提交，
    # 缩短其他同事等待写锁的时间。之后任一步失败，回滚时自动删除这些新文件（files.save 已登记）。
    stored_images = {clause_no: [{"mime_type": image["mime_type"],
                                  "file_path": files.save("drafts", image["data"], image["mime_type"])}
                                 for image in images]
                     for clause_no, images in illustrations.items()}
    try:
        standard = db.query_one("SELECT * FROM standard WHERE id = %s AND archived_at IS NULL", (standard_id,))
        if not standard:
            raise ApiError("所选标准不存在，请重新选择")
        if draft_id:
            comparison_service.assert_source_unbound(draft_id)
            draft = _get(draft_id)
            if draft["standard_id"] != standard_id:
                raise ApiError("草案不属于所选标准")
        else:
            data = clean(target, FIELDS)
            data["standard_id"] = standard_id
            _validate(data)
            draft_id = db.insert("draft", stamp_update(stamp_create(data)))
        latest = db.query_one("SELECT MAX(id) AS batch_id FROM draft_import WHERE draft_id = %s", (draft_id,))["batch_id"]
        if latest is not None and target.get("replace_import_id") != latest:
            raise ApiError("本次导入将整体替换当前章节，请刷新并确认替换及批注保留项。", 409)
        old_annotations = db.query("""SELECT a.id, a.content, a.annotation_type, a.updated_at, c.clause_no FROM draft_annotation a
            INNER JOIN draft_chapter c ON c.id = a.chapter_id
            WHERE a.draft_id = %s AND c.import_batch_id = %s ORDER BY c.sequence, a.id""",
            (draft_id, latest))
        linked_comments = _linked_comments(draft_id)
        if latest is not None and (annotation_snapshot != {
                str(a["id"]): {key: a[key] for key in ("content", "annotation_type", "updated_at")}
                for a in old_annotations}
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
        retained_annotations = [row for row in old_annotations
                              if row["id"] in keep_ids or
                              (row["clause_no"] in incoming and incoming[row["clause_no"]]
                               and row["id"] not in replace_ids)]
        retained_clauses = {row["clause_no"] for row in retained_annotations}
        replaced_clauses = {row["clause_no"] for row in old_annotations if row["id"] in replace_ids}
        retained_imports = {row["clause_no"] for row in retained_annotations
                            if row["annotation_type"] == IMPORTED_ANNOTATION_TYPE
                            and row["content"].strip() == incoming.get(row["clause_no"])}
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
            for position, image in enumerate(stored_images.get(chapter["clause_no"], []), start=1):
                db.insert("draft_chapter_image", {
                    "draft_id": draft_id, "chapter_id": chapter_id, "position": position, **image})
        for annotation in retained_annotations:
            db.update("draft_annotation", annotation["id"], {"chapter_id": new_chapters[annotation["clause_no"]]})
        for clause_no, content in initial_comments.items():
            if content and clause_no not in retained_imports and (
                    clause_no not in retained_clauses or clause_no in replaced_clauses):
                created_at = now()
                user = current_user()
                db.insert("draft_annotation", {
                    "draft_id": draft_id, "chapter_id": new_chapters[clause_no],
                    "annotation_type": IMPORTED_ANNOTATION_TYPE,
                    "content": content, "created_at": created_at,
                    "created_by": user, "updated_at": created_at, "updated_by": user,
                })
        if latest is not None:
            for comment in linked_comments:
                if comment["clause_no"] and comment["clause_no"].strip() not in new_chapters:
                    db.delete("comment", comment["id"])
        # 旧批次的章节与附图记录随之级联删除；附图文件在提交成功后再删除。
        files.remove_after_commit(_image_files(
            "draft_id = %s AND chapter_id IN (SELECT id FROM draft_chapter WHERE import_batch_id <> %s)",
            (draft_id, batch_id)))
        db.execute("DELETE FROM draft_import WHERE draft_id = %s AND id <> %s", (draft_id, batch_id))
        for annotation in annotations(draft_id):
            opinion_service.sync_annotation(annotation["id"], annotation["needs_follow_up"] or 0)
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
    flag = opinion_service.follow_up_value(data, default=1)
    check_enum(data, "annotation_type", ANNOTATION_TYPES, "批注类型", required=True)
    content = data.get("content")
    if not isinstance(content, str) or not content.strip():
        raise ApiError("请填写批注内容", field="content")
    chapter_id = data.get("chapter_id")
    if chapter_id is not None:
        chapter_id = record_id(chapter_id, "chapter_id")
        chapter = db.query_one("SELECT id FROM draft_chapter WHERE id = %s AND draft_id = %s", (chapter_id, draft_id))
        if not chapter:
            raise ApiError("章节已被替换，请刷新后对当前章节批注", 409)
    annotation_id = db.insert("draft_annotation", {
        "draft_id": draft_id, "chapter_id": chapter_id, "content": content.strip(),
        "annotation_type": data["annotation_type"],
        "created_at": now(), "created_by": current_user(),
        "updated_at": now(), "updated_by": current_user(),
    })
    opinion_service.sync_annotation(annotation_id, flag)
    db.commit()
    return jsonify(next(a for a in annotations(draft_id) if a["id"] == annotation_id)), 201


@bp.put("/<int:draft_id>/annotations/<int:annotation_id>")
def update_annotation(draft_id, annotation_id):
    _get(draft_id)
    annotation = db.query_one(
        "SELECT * FROM draft_annotation WHERE id = %s AND draft_id = %s",
        (annotation_id, draft_id))
    if not annotation:
        raise ApiError("批注不存在", 404)
    data = payload_of(request)
    flag = opinion_service.follow_up_value(data)
    check_enum(data, "annotation_type", ANNOTATION_TYPES, "批注类型", required=True)
    content = data.get("content")
    if not isinstance(content, str) or not content.strip():
        raise ApiError("请填写批注内容", field="content")
    if annotation["chapter_id"] is not None and not db.query_one(
            "SELECT id FROM draft_chapter WHERE id = %s AND draft_id = %s",
            (annotation["chapter_id"], draft_id)):
        raise ApiError("章节已被替换，请刷新后编辑当前批注", 409)
    db.update("draft_annotation", annotation_id, {
        "content": content.strip(), "annotation_type": data["annotation_type"],
        "updated_at": now(), "updated_by": current_user(),
    })
    opinion_service.sync_annotation(annotation_id, flag)
    db.commit()
    return jsonify(next(a for a in annotations(draft_id) if a["id"] == annotation_id))


@bp.delete("/<int:draft_id>/annotations/<int:annotation_id>")
def remove_annotation(draft_id, annotation_id):
    _get(draft_id)
    annotation = db.query_one(
        "SELECT created_by FROM draft_annotation WHERE id = %s AND draft_id = %s",
        (annotation_id, draft_id))
    if not annotation:
        raise ApiError("批注不存在", 404)
    if annotation["created_by"] != current_user():
        raise ApiError("仅允许操作人删除自己创建的批注", 403)
    db.delete("draft_annotation", annotation_id)
    db.commit()
    return jsonify(ok=True)
