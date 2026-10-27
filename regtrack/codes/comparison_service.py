"""Comparison source binding, import contract and source-of-truth reads."""
import json
import db
import files
from comment_model import SUBMISSION_CHANNEL
from common import ApiError

CHANGE_TYPES = ('Unchanged', 'Added', 'Deleted', 'Modified', 'Moved', 'Split', 'Merged', 'Reorganized')
CLASSES = ('Substantive', 'Editorial', 'Unchanged', 'Uncertain')
HEADERS = ('Row_key', 'Before_clause_nos', 'After_clause_nos', 'Change_type',
           'Revision_class', 'Summary_cn', 'Summary_en', 'Reason_cn', 'Reason_en', 'Review_note')
META_HEADERS = ('Standard_id', 'Before_draft_id', 'After_draft_id', 'Before_import_id', 'After_import_id')


def pair(before, after):
    try:
        before, after = int(before), int(after)
    except (ValueError, TypeError):
        raise ApiError('Please select both drafts / 请选择前后草案')
    rows = [db.query_one('SELECT * FROM draft WHERE id=%s', (i,)) for i in (before, after)]
    if not all(rows):
        raise ApiError('Draft not found / 草案不存在', 404)
    b, a = rows
    if before == after or b['standard_id'] != a['standard_id']:
        raise ApiError('Select two different drafts of the same standard / 必须选择同一标准的不同草案')
    if b['draft_date'] > a['draft_date']:
        raise ApiError('Before draft must not be later than after draft / 前版日期不能晚于后版')
    for row in rows:
        batch = db.query_one('SELECT MAX(id) AS batch_id FROM draft_import WHERE draft_id=%s', (row['id'],))['batch_id']
        if not batch or not db.query_one('SELECT id FROM draft_chapter WHERE import_batch_id=%s', (batch,)):
            raise ApiError('Both drafts need imported source chapters / 两版草案都需要先导入原文章节')
        row['import_id'] = batch
    return b, a


def meta(b, a):
    return [b['standard_id'], b['id'], a['id'], b['import_id'], a['import_id']]


def chapters(batch):
    rows = db.query('SELECT * FROM draft_chapter WHERE import_batch_id=%s ORDER BY sequence', (batch,))
    images = {row['id']: [] for row in rows}
    for image in db.query('''SELECT i.id, i.chapter_id, i.position, i.mime_type, i.file_path FROM draft_chapter_image i
                             INNER JOIN draft_chapter c ON c.id = i.chapter_id
                             WHERE c.import_batch_id=%s ORDER BY i.chapter_id, i.position''', (batch,)):
        image['url'] = files.url(image['file_path'])
        images[image.pop('chapter_id')].append(image)
    for row in rows:
        row['images'] = images[row['id']]
    return rows


def get_comparison(cid):
    result = db.query_one('SELECT * FROM draft_comparison WHERE id=%s', (cid,))
    if not result:
        raise ApiError('Comparison not found / 比对不存在', 404)
    drafts = {d['id']: d for d in db.query('SELECT * FROM draft WHERE id IN (%s, %s)',
                                           (result['before_draft_id'], result['after_draft_id']))}
    result['before'], result['after'] = drafts[result['before_draft_id']], drafts[result['after_draft_id']]
    result['standard'] = db.query_one('SELECT * FROM standard WHERE id=%s', (result['standard_id'],))
    imports = {i['id']: i for i in db.query('SELECT * FROM draft_import WHERE id IN (%s, %s)',
                                            (result['before_import_id'], result['after_import_id']))}
    result['before_source'], result['after_source'] = imports[result['before_import_id']], imports[result['after_import_id']]
    sources = {side: {c['clause_no']: c for c in chapters(result[f'{side}_import_id'])} for side in ('before', 'after')}
    result['changes'] = db.query('SELECT * FROM comparison_change WHERE comparison_id=%s ORDER BY sequence', (cid,))
    opinions = {change['id']: [] for change in result['changes']}
    for opinion in db.query(f'''SELECT o.change_id, c.*, {SUBMISSION_CHANNEL} FROM (comparison_opinion o
                               INNER JOIN comment c ON c.id=o.comment_id)
                               INNER JOIN comparison_change cc ON cc.id=o.change_id
                               WHERE cc.comparison_id=%s ORDER BY c.id''', (cid,)):
        opinions[opinion.pop('change_id')].append(opinion)
    for change in result['changes']:
        for side in ('before', 'after'):
            change[f'{side}_nos'] = json.loads(change[f'{side}_nos'])
            change[f'{side}_chapters'] = [sources[side][n] for n in change[f'{side}_nos']]
        change['identical'] = (len(change['before_chapters']) == len(change['after_chapters']) == 1
                               and identical(change['before_chapters'][0], change['after_chapters'][0]))
        change['opinions'] = opinions[change['id']]
    return result


def assert_source_unbound(draft_id):
    if db.query_one('SELECT id FROM draft_comparison WHERE before_draft_id=%s OR after_draft_id=%s', (draft_id, draft_id)):
        raise ApiError('This source is used by a comparison. Remove its opinions and comparison before replacing it / 原文已被比对引用，请先处理批注并删除比对再更换原文', 409)


def identical(old, new):
    """Text (whitespace-normalised), numbering and number of figures are the same on both sides.
    Figure content is not compared: the comparison works on text, as the prompt instructs the model."""
    fields = ('clause_no', 'title_cn', 'content_cn', 'title_en', 'content_en', 'illustration')
    return (all(' '.join((old.get(f) or '').split()) == ' '.join((new.get(f) or '').split()) for f in fields)
            and len(old['images']) == len(new['images']))


def validate_rows(raw_rows, b, a):
    original = {'before': {c['clause_no']: c for c in chapters(b['import_id'])},
                'after': {c['clause_no']: c for c in chapters(a['import_id'])}}
    sources = {side: set(rows) for side, rows in original.items()}
    seen = {'before': set(), 'after': set()}
    keys = set()
    output = []
    for number, cells in enumerate(raw_rows, 2):
        if not any(v is not None and str(v).strip() for v in cells):
            continue
        row = {h: str(v).strip() if v is not None else '' for h, v in zip(HEADERS, cells)}
        prefix = f'Changes row {number}: '
        if not row['Row_key'] or row['Row_key'] in keys:
            raise ApiError(prefix + 'Row_key is missing or duplicated / 行标识为空或重复')
        keys.add(row['Row_key'])
        if row['Change_type'] not in CHANGE_TYPES or row['Revision_class'] not in CLASSES:
            raise ApiError(prefix + 'Invalid change type or revision class / 修订类型或性质无效')
        refs = {}
        for side in ('before', 'after'):
            refs[side] = [n.strip() for n in row[f'{side.title()}_clause_nos'].split(';') if n.strip()]
            if len(set(refs[side])) != len(refs[side]) or not set(refs[side]) <= sources[side]:
                raise ApiError(prefix + f'{side} clause references are invalid / 条款号重复或不存在')
            if seen[side] & set(refs[side]):
                raise ApiError(prefix + f'{side} clauses already mapped / 同一条款不能出现在多个对应行')
            seen[side].update(refs[side])
        kind, cls = row['Change_type'], row['Revision_class']
        bn, an = len(refs['before']), len(refs['after'])
        valid_shape = ((kind == 'Added' and bn == 0 and an >= 1) or
                       (kind == 'Deleted' and bn >= 1 and an == 0) or
                       (kind == 'Split' and bn == 1 and an > 1) or
                       (kind == 'Merged' and bn > 1 and an == 1) or
                       (kind == 'Reorganized' and bn > 1 and an > 1) or
                       (kind in ('Unchanged', 'Modified', 'Moved') and bn == an == 1))
        if not valid_shape:
            raise ApiError(prefix + 'Clause mapping does not match change type / 对应关系与修订类型不符')
        texts = dict(summary_cn=row['Summary_cn'], summary_en=row['Summary_en'], reason_cn=row['Reason_cn'],
                     reason_en=row['Reason_en'], review_note=row['Review_note'])
        output.append(dict(texts, row_key=row['Row_key'], sequence=len(output)+1,
                           before_nos=json.dumps(refs['before'], ensure_ascii=False),
                           after_nos=json.dumps(refs['after'], ensure_ascii=False),
                           change_type=kind, revision_class=cls))
    for side in ('before', 'after'):
        missing = sources[side] - seen[side]
        if missing:
            raise ApiError(f'{side}: missing clauses / 存在未覆盖条款: ' + ', '.join(sorted(missing)))
    return output


def validate_stored(cid):
    """Validate comparison records entering through the user-data exchange boundary."""
    record = db.query_one('SELECT * FROM draft_comparison WHERE id=%s', (cid,))
    b, a = pair(record['before_draft_id'], record['after_draft_id'])
    if record['standard_id'] != b['standard_id']:
        raise ApiError('Comparison standard mismatch')
    # A saved comparison keeps its source snapshot, even after a newer import.
    b['import_id'] = record['before_import_id']
    a['import_id'] = record['after_import_id']
    rows = db.query('SELECT * FROM comparison_change WHERE comparison_id=%s ORDER BY sequence', (cid,))
    raw = []
    for row in rows:
        try:
            refs = [json.loads(row[f'{side}_nos']) for side in ('before','after')]
            if any(not isinstance(values,list) or any(not isinstance(n,str) for n in values) for values in refs):
                raise ValueError
        except (ValueError, TypeError):
            raise ApiError('Invalid comparison clause references / 比对条款引用格式无效') from None
        raw.append([row['row_key'], ';'.join(refs[0]), ';'.join(refs[1]), row['change_type'], row['revision_class'],
                    row['summary_cn'], row['summary_en'], row['reason_cn'], row['reason_en'], row['review_note']])
        for opinion in db.query('''SELECT c.* FROM comparison_opinion o INNER JOIN comment c ON c.id=o.comment_id
                                   WHERE o.change_id=%s''', (row['id'],)):
            expected = dict(standard_id=record['standard_id'], source_kind='comparison',
                            before_draft_id=b['id'], after_draft_id=a['id'],
                            before_clause_no=';'.join(refs[0]) or None, after_clause_no=';'.join(refs[1]) or None)
            if any(opinion[k] != v for k,v in expected.items()):
                raise ApiError('Comparison opinion binding mismatch / 比对批注来源绑定不一致')
    validate_rows(raw,b,a)
