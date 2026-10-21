"""Annotation/opinion synchronization, within caller transaction."""
import db
import comment_history
from common import ApiError, today, now, current_user, stamp_create, stamp_update


def follow_up_value(payload, default=0):
    value = payload.get('needs_follow_up', default)
    if not isinstance(value, (bool, int)) or value not in (0, 1):
        raise ApiError('Follow-up required must be a boolean', field='needs_follow_up')
    return int(value)


def apply_follow_up(data, previous=None):
    flag = follow_up_value(data, previous['needs_follow_up'] if previous else 0)
    data['needs_follow_up'] = flag
    if previous is None or flag != previous['needs_follow_up']:
        data['status'] = 'Submitted' if flag else 'Draft'
    else:
        data['status'] = previous['status']


def record_change(previous, data):
    comment_history.automatic(previous, data)


def sync_annotation(annotation_id, flag):
    note = db.query_one("""SELECT a.*, d.standard_id, ch.clause_no FROM draft_annotation a
        JOIN draft d ON d.id=a.draft_id LEFT JOIN draft_chapter ch ON ch.id=a.chapter_id
        WHERE a.id=?""", (annotation_id,))
    previous = db.query_one('SELECT * FROM comment WHERE source_annotation_id=?', (annotation_id,))
    data = dict(source_kind='single', standard_id=note['standard_id'], draft_id=note['draft_id'],
        clause_no=note['clause_no'], comment_type=note['annotation_type'], comment_text=note['content'],
        needs_follow_up=flag)
    apply_follow_up(data, previous)
    if previous:
        record_change(previous, data)
        db.update('comment', previous['id'], stamp_update(data))
    else:
        data.update(source_annotation_id=annotation_id, submitted_by=note['created_by'],
            submission_date=note['created_at'][:10], comment_no=db.next_serial('comment', 'comment_no', 'CM', today()[:4]))
        cid = db.insert('comment', stamp_update(stamp_create(data)))
        comment_history.initial(cid, data['status'], today())
