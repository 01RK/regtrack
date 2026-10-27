"""Append-only opinion status events, saved with the parent edit transaction."""
import db
from common import ApiError, check_date, current_user, now, today, stamp_update
from constants import COMMENT_STATUSES


def initial(comment_id, value, effective_date):
    db.insert('comment_status_history', dict(comment_id=comment_id, previous_value=None,
        new_value=value, effective_date=effective_date, recorded_at=now(), recorded_by=current_user()))


def automatic(previous, data):
    if previous['status'] != data['status']:
        db.insert('comment_status_history', dict(comment_id=previous['id'], previous_value=previous['status'],
            new_value=data['status'], effective_date=today(), recorded_at=now(), recorded_by=current_user()))


def append(comment_id, payload):
    if not isinstance(payload, dict):
        raise ApiError('Status update must be an object', field='status_update')
    allowed = {'new_value', 'effective_date', 'response', 'follow_up', 'supporting_reference'}
    if set(payload) - allowed:
        raise ApiError('Unsupported status update fields', field='status_update')
    value = payload.get('new_value')
    if value not in COMMENT_STATUSES or value in ('Draft', 'Submitted'):
        raise ApiError('Draft and Submitted are controlled by Follow-up required', field='new_value')
    if not payload.get('effective_date'):
        raise ApiError('Effective Date is required', field='effective_date')
    check_date(payload, 'effective_date', 'Effective Date')
    row = db.query_one('SELECT status, needs_follow_up FROM comment WHERE id=%s', (comment_id,))
    if not row['needs_follow_up']:
        raise ApiError('Enable Follow-up required before adding a processing status', field='needs_follow_up')
    data = dict(comment_id=comment_id, previous_value=row['status'], new_value=value,
        effective_date=payload['effective_date'], recorded_at=now(), recorded_by=current_user())
    for field in ('response', 'follow_up', 'supporting_reference'):
        text = payload.get(field)
        if text is not None and not isinstance(text, str):
            raise ApiError('Expected text', field=field)
        data[field] = text.strip() or None if text is not None else None
    db.insert('comment_status_history', data)
    db.update('comment', comment_id, stamp_update({'status': value}))
