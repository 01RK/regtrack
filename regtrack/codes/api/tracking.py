"""Collection settings and persistent shared notification inbox."""
from flask import Blueprint, current_app, jsonify, request
import db
from common import ApiError, payload_of
import tracking_service as service

bp = Blueprint('tracking', __name__, url_prefix='/api/tracking')


@bp.get('/settings')
def settings():
    return jsonify(service.settings())


@bp.put('/settings')
def save_settings():
    return jsonify(service.save_settings(payload_of(request)))


@bp.post('/run')
def run():
    current_app.extensions['collection_scheduler'].manual()
    return jsonify(queued=True), 202


def inbox_rows():
    return db.query('SELECT n.*, c.decision, c.decided_by, '
                    's.name_cn AS standard_name_cn, s.std_no '
                    'FROM (notification n LEFT JOIN tracking_candidate c ON c.id = n.candidate_id) '
                    'LEFT JOIN standard s ON s.id = n.standard_id ORDER BY n.id DESC')


def inbox_counts(rows):
    return dict(plans=sum(r['kind'] == 'plans' and not r['is_read'] for r in rows),
                comments=sum(r['kind'] == 'comments' and not r['is_read'] for r in rows),
                releases=sum(r['kind'] == 'releases' and not r['is_read'] for r in rows),
                all=len(rows), attention=sum(not r['is_read'] for r in rows),
                pending=sum(r['decision'] == 'pending' for r in rows))


@bp.get('/summary')
def summary():
    return jsonify(inbox_counts(inbox_rows()))


@bp.get('/notifications')
def notifications():
    try:
        page = max(1, int(request.args.get('page', 1)))
    except ValueError:
        raise ApiError('页码必须是整数')
    rows = inbox_rows()
    counts = inbox_counts(rows)
    view = request.args.get('view') or next((v for v in ('plans','comments','releases') if counts[v]), 'all')
    if view not in ('plans', 'comments', 'releases', 'all'):
        raise ApiError('消息筛选不存在')
    if view != 'all':
        rows = [r for r in rows if r['kind'] == view and not r['is_read']]
    rows.sort(key=lambda r: (bool(r['is_read']), -r['id']))
    page = min(page, max(1, (len(rows) + 19) // 20))
    return jsonify(items=rows[(page-1)*20:page*20], total=len(rows), page=page, view=view, counts=counts)


@bp.post('/notifications/<int:notification_id>/acknowledge')
def acknowledge(notification_id):
    from common import current_user, now
    row = db.query_one('SELECT n.id, c.decision FROM notification n '
                       'LEFT JOIN tracking_candidate c ON c.id = n.candidate_id WHERE n.id = %s', (notification_id,))
    if not row:
        raise ApiError('消息不存在', 404)
    if row['decision'] == 'pending':
        raise ApiError('请先确认追踪或本次忽略该计划', 409)
    db.execute('UPDATE notification SET is_read = 1, acknowledged_by = %s, acknowledged_at = %s '
               'WHERE id = %s AND is_read = 0', (current_user(), now(), notification_id))
    db.commit()
    return jsonify(ok=True)


@bp.post('/candidates/<int:candidate_id>/decision')
def decide(candidate_id):
    return jsonify(service.decide(candidate_id, payload_of(request).get('decision')))
