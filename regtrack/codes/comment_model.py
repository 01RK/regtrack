"""Opinion source binding and reference validation shared by API and data exchange."""
import db
from common import ApiError, check_date, check_enum, require
from constants import ANNOTATION_TYPES, COMMENT_SOURCES, COMMENT_STATUSES

# 提交渠道由意见来源决定（意见表别名须为 c），查询时随行返回 submission_channel。
SUBMISSION_CHANNEL = (f"CASE WHEN c.source_kind = 'single' THEN '{COMMENT_SOURCES['single']}' "
                      f"ELSE '{COMMENT_SOURCES['comparison']}' END AS submission_channel")


def bind_annotation(data):
    if not data.get("source_annotation_id"):
        return
    source = db.query_one("""SELECT a.draft_id, d.standard_id, ch.clause_no
        FROM (draft_annotation a INNER JOIN draft d ON d.id = a.draft_id)
        LEFT JOIN draft_chapter ch ON ch.id = a.chapter_id WHERE a.id = %s""",
        (data["source_annotation_id"],))
    if not source:
        raise ApiError("来源批注不存在", field="source_annotation_id")
    data.update(source_kind="single", standard_id=source["standard_id"],
                draft_id=source["draft_id"], clause_no=source["clause_no"],
                before_draft_id=None, before_clause_no=None, after_draft_id=None, after_clause_no=None)



def validate(data: dict) -> None:
    require(data, [("standard_id", "Standard"), ("comment_text", "Comment / Proposal"),
                   ("source_kind", "意见来源"), ("comment_type", "评论类型"),
                   ("status", "Comment Status"), ("submitted_by", "Submitted By")])
    check_enum(data, "source_kind", COMMENT_SOURCES, "意见来源", required=True)
    check_enum(data, "comment_type", ANNOTATION_TYPES, "评论类型", required=True)
    check_enum(data, "status", COMMENT_STATUSES, "Comment Status", required=True)
    check_date(data, "submission_date", "Submission Date")
    if not db.query_one("SELECT id FROM standard WHERE id = %s", (data["standard_id"],)):
        raise ApiError("所选标准不存在", field="standard_id")
    if data["source_kind"] == "comparison":
        require(data, [("before_draft_id", "前一版草案"), ("after_draft_id", "后一版草案")])
        if any(data.get(k) for k in ("draft_id", "clause_no")):
            raise ApiError("比对意见请分别填写前后版本，不使用单版本草案字段", field="draft_id")
        fields = ("before_draft_id", "after_draft_id")
    else:
        require(data, [("draft_id", "Related Draft")])
        if any(data.get(k) for k in ("before_draft_id", "before_clause_no", "after_draft_id", "after_clause_no")):
            raise ApiError("单版本意见不能填写比对版本字段", field="source_kind")
        fields = ("draft_id",)
    drafts = {}
    for field in fields:
        if not data.get(field):
            continue
        draft = db.query_one("SELECT standard_id, draft_date FROM draft WHERE id=%s", (data[field],))
        if not draft or int(draft["standard_id"]) != int(data["standard_id"]):
            raise ApiError("草案不存在或不属于所选标准", field=field)
        drafts[field] = draft
    if data["source_kind"] == "comparison":
        if int(data["before_draft_id"]) == int(data["after_draft_id"]):
            raise ApiError("前后草案必须是不同版本", field="after_draft_id")
        if drafts["before_draft_id"]["draft_date"] > drafts["after_draft_id"]["draft_date"]:
            raise ApiError("前一版草案日期不能晚于后一版", field="before_draft_id")

