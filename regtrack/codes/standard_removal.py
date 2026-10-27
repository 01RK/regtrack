"""永久删除标准主档及其全部业务记录。

一并删除：草案（含原文章节、附图文件、批注）、意见（含状态历史、比对意见关联）、标准比对、
关联事项（含状态历史与反馈对象）、阶段历史与影响领域。
工作组会议保留，只解除与该标准的挂载（连同挂载上的批注与会议阶段快照）。

删除顺序显式写出，明确处理跨表引用的删除顺序：
草案比对引用导入批次而无级联，必须先于草案删除。
"""

import db
import files

_SCOPE = """
SELECT
  (SELECT COUNT(*) FROM draft WHERE standard_id = %s) AS drafts,
  (SELECT COUNT(*) FROM draft_chapter_image i INNER JOIN draft d ON d.id = i.draft_id
    WHERE d.standard_id = %s) AS images,
  (SELECT COUNT(*) FROM comment WHERE standard_id = %s) AS comments,
  (SELECT COUNT(*) FROM draft_comparison WHERE standard_id = %s) AS comparisons,
  (SELECT COUNT(*) FROM action_item WHERE standard_id = %s) AS actions,
  (SELECT COUNT(*) FROM meeting_standard WHERE standard_id = %s) AS meetings
  FROM standard WHERE id = %s
"""


def impact(standard_id: int) -> dict:
    """删除前展示给用户的影响范围（条数）。"""
    result = db.query_one(_SCOPE, (standard_id,) * 7)
    result['files'] = db.query_one('SELECT COUNT(*) AS n FROM managed_file WHERE standard_id=%s',(standard_id,))['n']
    return result


def remove(standard_id: int) -> dict:
    """在调用方的事务中删除；附图文件在提交成功后删除。返回删除前的影响范围。"""
    db.execute('SELECT id FROM standard WHERE id=%s FOR UPDATE',(standard_id,))
    files.remove_after_commit([r['object_key'] for r in db.query('SELECT object_key FROM managed_file WHERE standard_id=%s',(standard_id,))])
    scope = impact(standard_id)
    files.remove_after_commit([row["file_path"] for row in db.query(
        """SELECT i.file_path FROM draft_chapter_image i INNER JOIN draft d ON d.id = i.draft_id
            WHERE d.standard_id = %s""", (standard_id,))])
    for sql in (
        "DELETE FROM comment WHERE standard_id = %s",            # 状态历史、比对意见关联随之删除
        "DELETE FROM draft_comparison WHERE standard_id = %s",   # 修订条目随之删除
        "DELETE FROM action_item WHERE standard_id = %s",        # 状态历史、反馈对象随之删除
        "DELETE FROM draft WHERE standard_id = %s",              # 导入批次、章节、附图记录、批注随之删除
        "DELETE FROM standard WHERE id = %s",                    # 阶段历史、影响领域、会议挂载随之删除
    ):
        db.execute(sql, (standard_id,))
    return scope
