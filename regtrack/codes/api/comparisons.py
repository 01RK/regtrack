"""Draft comparison HTTP endpoints. No model credentials or external calls."""
import json
from flask import Blueprint, jsonify, request, send_file
import db
import comment_history
import comment_model
import opinion_service
import lookups_service
from common import ApiError, current_user, now, today, stamp_create, stamp_update, payload_of, require, check_enum
from constants import ANNOTATION_TYPES
import comparison_service as service
import comparison_workbook as exchange

bp = Blueprint('comparisons', __name__, url_prefix='/api/comparisons')


def selected_pair(source):
    return service.pair(source.get('before_draft_id'), source.get('after_draft_id'))


@bp.get('/options')
def options():
    """Drafts of one standard with their imported chapter counts. Standards come from /api/standards/options."""
    sid = request.args.get('standard_id', type=int)
    return jsonify(db.query('''SELECT d.*, (SELECT COUNT(*) FROM draft_chapter c WHERE c.draft_id=d.id) AS chapter_count
                              FROM draft d WHERE d.standard_id=%s ORDER BY d.draft_date, d.id''', (sid,)))


@bp.get('')
def listing():
    sid = request.args.get('standard_id', type=int)
    return jsonify(db.query('''SELECT p.*, b.version_name AS before_version, b.sub_version_no AS before_sub,
        a.version_name AS after_version, a.sub_version_no AS after_sub,
        (SELECT COUNT(*) FROM comparison_change c WHERE c.comparison_id=p.id) AS row_count
        FROM (draft_comparison p INNER JOIN draft b ON b.id=p.before_draft_id)
             INNER JOIN draft a ON a.id=p.after_draft_id
        WHERE p.standard_id=%s ORDER BY p.id DESC''', (sid,)))


XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'


@bp.get('/pair')
def confirm_pair():
    b, a = selected_pair(request.args)
    counts = {side: db.query_one('SELECT COUNT(*) AS n FROM draft_chapter WHERE import_batch_id=%s', (d['import_id'],))['n']
              for side, d in (('before', b), ('after', a))}
    saved = db.query_one('SELECT id FROM draft_comparison WHERE before_draft_id=%s AND after_draft_id=%s', (b['id'], a['id']))
    standard = db.query_one('SELECT std_no, name_cn, name_en FROM standard WHERE id=%s', (b['standard_id'],))
    return jsonify(standard=standard, before=dict(b, chapter_count=counts['before']), after=dict(a, chapter_count=counts['after']),
                   comparison_id=saved and saved['id'], workbook_name=exchange.filename(b, a, '比对工作簿'))


@bp.get('/workbook')
def comparison_workbook():
    b, a = selected_pair(request.args)
    return send_file(exchange.workbook(b, a), as_attachment=True, mimetype=XLSX, max_age=0,
                     download_name=exchange.filename(b, a, '比对工作簿'))


def uploaded_rows():
    b, a = selected_pair(request.form)
    rows = service.validate_rows(exchange.read_workbook(request.files.get('file')), b, a)
    return b, a, rows


@bp.post('/preview')
def preview():
    b, a, rows = uploaded_rows()
    counts = {key: sum(r['revision_class'] == key for r in rows) for key in service.CLASSES}
    return jsonify(row_count=len(rows), counts=counts, rows=rows)


@bp.post('/import')
def import_result():
    b, a, rows = uploaded_rows()
    if db.query_one('SELECT id FROM draft_comparison WHERE before_draft_id=%s AND after_draft_id=%s', (b['id'], a['id'])):
        raise ApiError('Comparison already exists; remove it explicitly before importing again / 比对已存在，请明确删除后重新导入', 409)
    cid = db.insert('draft_comparison', dict(standard_id=b['standard_id'], before_draft_id=b['id'],
        after_draft_id=a['id'], before_import_id=b['import_id'], after_import_id=a['import_id'],
        created_at=now(), created_by=current_user()))
    for row in rows:
        db.insert('comparison_change', dict(row, comparison_id=cid))
    db.commit()
    return jsonify(id=cid, row_count=len(rows)), 201


@bp.get('/<int:cid>')
def detail(cid):
    return jsonify(service.get_comparison(cid))


@bp.get('/<int:cid>/export')
def export(cid):
    result = service.get_comparison(cid)
    b, a = result['before'], result['after']
    b['import_id'], a['import_id'] = result['before_import_id'], result['after_import_id']
    return send_file(exchange.workbook(b, a, result['changes']), as_attachment=True, mimetype=XLSX, max_age=0,
                     download_name=exchange.filename(b, a, '比对结果'))


@bp.delete('/<int:cid>')
def remove(cid):
    service.get_comparison(cid)
    if db.query_one('''SELECT o.id FROM comparison_opinion o INNER JOIN comparison_change c ON c.id=o.change_id
                       WHERE c.comparison_id=%s''', (cid,)):
        raise ApiError('Remove linked opinions first; they will not be silently deleted / 请先处理并删除关联意见，比对删除不会静默删除批注', 409)
    db.delete('draft_comparison', cid)
    db.commit()
    return jsonify(ok=True)


@bp.put('/changes/<int:change_id>')
def edit_change(change_id):
    """Manual review of revision class and bilingual analysis. The clause mapping stays as imported."""
    change = db.query_one('''SELECT c.*, p.before_import_id, p.after_import_id FROM comparison_change c
                            INNER JOIN draft_comparison p ON p.id=c.comparison_id WHERE c.id=%s''', (change_id,))
    if not change:
        raise ApiError('Change not found / 修订条目不存在', 404)
    payload = payload_of(request)
    check_enum(payload, 'revision_class', service.CLASSES, 'Revision class', required=True)
    cls = payload['revision_class']
    texts = {k: str(payload.get(k) or '').strip() for k in ('summary_cn', 'summary_en', 'reason_cn', 'reason_en')}
    texts['review_note'] = str(payload.get('review_note', change['review_note']) or '').strip()
    # Analysis is user/model-authored; do not infer or enforce its correctness.
    analysis = dict(texts, revision_class=cls)
    db.update('comparison_change', change_id, analysis)
    db.commit()
    return jsonify(analysis)


@bp.post('/changes/<int:change_id>/opinions')
def annotate(change_id):
    change = db.query_one('''SELECT c.*, p.standard_id, p.before_draft_id, p.after_draft_id
                            FROM comparison_change c INNER JOIN draft_comparison p ON p.id=c.comparison_id WHERE c.id=%s''', (change_id,))
    if not change:
        raise ApiError('Change not found / 修订条目不存在', 404)
    payload = payload_of(request)
    if not isinstance(payload.get('content'), str):
        raise ApiError('Annotation content must be text / 批注内容必须为文本')
    require(payload, [('content', 'Content / 批注内容'), ('annotation_type', 'Type / 批注类型')])
    check_enum(payload, 'annotation_type', ANNOTATION_TYPES, 'Annotation type', required=True)
    before, after = json.loads(change['before_nos']), json.loads(change['after_nos'])
    data = dict(standard_id=change['standard_id'], source_kind='comparison',
                before_draft_id=change['before_draft_id'], after_draft_id=change['after_draft_id'],
                before_clause_no=';'.join(before) or None, after_clause_no=';'.join(after) or None,
                comment_type=payload['annotation_type'], comment_text=payload['content'].strip(),
                needs_follow_up=opinion_service.follow_up_value(payload, default=1),
                submitted_by=current_user(), submission_date=today())
    opinion_service.apply_follow_up(data)
    comment_model.validate(data)
    data['comment_no'] = db.next_serial('comment', 'comment_no', 'CM', today()[:4])
    comment_id = db.insert('comment', stamp_update(stamp_create(data)))
    comment_history.initial(comment_id, data['status'], today())
    db.insert('comparison_opinion', dict(change_id=change_id, comment_id=comment_id))
    lookups_service.ensure_values('person', [data['submitted_by']])
    db.commit()
    return jsonify(id=comment_id), 201
