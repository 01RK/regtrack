"""会议纪要：校验 Excel 解析结果、匹配候选与一次性事务写入。"""
from difflib import SequenceMatcher
import json
import re
import unicodedata

import db
import lookups_service
import stages
import status
from meeting_actions import review_actions, validate_action_selection
from common import ApiError, check_date, sanitize, stamp_create, stamp_update, today

MEETING_FIELDS = ('title', 'meeting_date', 'key_discussions', 'overall_conclusion', 'organizer')


def texts(value, fields, required, label):
    if not isinstance(value, dict):
        raise ApiError(f'{label} 必须是对象')
    unknown = set(value) - set(fields)
    if unknown:
        raise ApiError(f'{label} 包含不支持的字段：{", ".join(sorted(unknown))}')
    result = {}
    for field in fields:
        text = value.get(field, '')
        if not isinstance(text, str) or len(text) > 30000:
            raise ApiError(f'{label}.{field} 必须是 30000 字以内的文本')
        result[field] = text.strip()
        if field in required and not result[field]:
            raise ApiError(f'请补全 {label}.{field}')
    return result


def validate(raw):
    if not isinstance(raw, dict) or set(raw) != {'meeting', 'standards', 'actions'}:
        raise ApiError('数据包必须包含 meeting、standards、actions 三个字段，请使用下载的模板')
    raw = sanitize(raw)
    if len(json.dumps(raw, ensure_ascii=False).encode('utf-8')) > 2 * 1024 * 1024:
        raise ApiError('会议数据包过大，请控制在 2 MB 以内')
    meeting = texts(raw['meeting'], MEETING_FIELDS, ('title', 'meeting_date', 'key_discussions'), 'meeting')
    check_date(meeting, 'meeting_date', 'Meeting Date')
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', meeting['meeting_date']):
        raise ApiError('Meeting Date 必须使用 YYYY-MM-DD 格式')
    result = {'meeting': meeting}
    for key, fields, required in (
        ('standards', ('key', 'name_cn', 'std_no', 'note'), ('key', 'name_cn', 'note')),
        ('actions', ('title', 'description', 'standard_key', 'owner', 'due_date'), ('title', 'description')),
    ):
        if not isinstance(raw[key], list) or len(raw[key]) > 300:
            raise ApiError(f'{key} 必须是数组，最多 300 条')
        result[key] = [texts(row, fields, required, f'{key}[{i + 1}]') for i, row in enumerate(raw[key])]
    keys = [s['key'] for s in result['standards']]
    if any(',' in key for key in keys):
        raise ApiError('Standard Key 不能包含逗号')
    identities = [(s['name_cn'], s['std_no']) for s in result['standards']]
    if len(set(keys)) != len(keys) or len(set(identities)) != len(identities):
        raise ApiError('标准 key 和标准条目不得重复，请合并同一标准的纪要')
    for action in result['actions']:
        if any(key not in keys for key in action_keys(action)):
            raise ApiError(f'事项「{action["title"]}」引用了不存在的 standard_key')
        check_date(action, 'due_date', '事项截止日期')
        if action['due_date'] and not re.fullmatch(r'\d{4}-\d{2}-\d{2}', action['due_date']):
            raise ApiError('事项截止日期必须使用 YYYY-MM-DD 格式')
    return result


def action_keys(action):
    return list(dict.fromkeys(key.strip() for key in action['standard_key'].split(',') if key.strip()))


def normalized(value):
    return re.sub(r'[\W_]+', '', unicodedata.normalize('NFKC', value).casefold())


def candidates(name, rows, field):
    scored = []
    for row in rows:
        score = SequenceMatcher(None, normalized(name), normalized(row[field]), autojunk=False).ratio()
        if score >= .7:
            scored.append(dict(row, similarity=round(score * 100, 1), exact=name == row[field]))
    return sorted(scored, key=lambda r: (-r['exact'], -r['similarity'], r['id']))[:3]


def preview(package):
    meeting = package['meeting']
    meetings = db.query('SELECT * FROM meeting')
    recommended = {m['id']: dict(m, same_day=m['meeting_date'] == meeting['meeting_date'], similar_title=True)
                   for m in candidates(meeting['title'], meetings, 'title')}
    for m in meetings:
        if m['meeting_date'] == meeting['meeting_date'] and m['id'] not in recommended:
            score = SequenceMatcher(None, normalized(meeting['title']), normalized(m['title']), autojunk=False).ratio()
            recommended[m['id']] = dict(m, same_day=True, similar_title=False,
                                       similarity=round(score*100, 1), exact=m['title']==meeting['title'])
    standards = db.query('SELECT id, std_no, name_cn, archived_at FROM standard')
    return dict(package=package,
                meetings=sorted(recommended.values(), key=lambda m: (not m['same_day'], not m['exact'], -m['similarity'], m['id'])),
                standards=[dict(key=s['key'], candidates=candidates(s['name_cn'], standards, 'name_cn'))
                           for s in package['standards']])


def merge_text(old, new):
    """保留人工内容，重复导入同一段纪要不重复追加。"""
    if not new or new in (old or ''):
        return old or ''
    return f'{old}\n\n{new}' if old else new


def commit_import(package, decision):
    if not isinstance(decision, dict):
        raise ApiError('请完成会议与标准确认')
    meeting_id = decision.get('meeting_id')
    choices = decision.get('standards')
    if not isinstance(choices, dict) or set(choices) != {s['key'] for s in package['standards']}:
        raise ApiError('请逐项确认所有标准')
    if decision.get('confirmed') is not True:
        raise ApiError('请核对预览并确认写入')
    try:
        db.execute('BEGIN IMMEDIATE')
        available = preview(package)
        if meeting_id != 'new' and not any(type(meeting_id) is int and m['id']==meeting_id for m in available['meetings']):
            raise ApiError('会议选择已失效，请重新预览并选择推荐会议')
        action_review = review_actions(package, decision)
        keep_new, keep_existing = validate_action_selection(action_review, decision.get('actions'))
        meeting = package['meeting']
        if meeting_id == 'new':
            if any(c['exact'] and c['same_day'] for c in available['meetings']):
                raise ApiError('同日同名会议已存在，请选择现有会议')
            data = {k: v for k, v in meeting.items() if v}
            data['meeting_no'] = db.next_serial('meeting', 'meeting_no', 'MTG', meeting['meeting_date'][:4])
            meeting_id = db.insert('meeting', stamp_update(stamp_create(data)))
        else:
            selected = next((m for m in available['meetings'] if type(meeting_id) is int and m['id'] == meeting_id), None)
            if selected is None:
                raise ApiError('会议选择已失效，请重新预览并选择推荐会议')
            # 标题与日期以用户确认的主记录为准，其他内容追加补全。
            data = {k: merge_text(selected[k], meeting[k]) for k in ('key_discussions', 'overall_conclusion')}
            if not selected['organizer']:
                data['organizer'] = meeting['organizer']
            db.update('meeting', meeting_id, stamp_update(data))
        lookups_service.ensure_values('organization', [meeting['organizer']])
        mapped, used = {}, set()
        counts = {'created_standards': 0, 'skipped_standards': 0, 'created_actions': 0, 'deleted_actions': 0, 'omitted_actions': 0, 'excluded_actions': 0}
        for source, match in zip(package['standards'], available['standards']):
            choice = choices[source['key']]
            if not isinstance(choice, dict):
                raise ApiError('标准确认格式不正确')
            mode = choice.get('mode')
            sid = None
            if mode == 'existing':
                sid = choice.get('id')
                selected = next((s for s in match['candidates'] if type(sid) is int and s['id'] == sid), None)
                if not selected:
                    raise ApiError(f'「{source["name_cn"]}」的标准选择已失效，请重新预览')
                if selected['archived_at']:
                    raise ApiError('该标准已归档，请先在标准主档恢复后再导入')
            elif mode == 'create':
                fields = texts(choice.get('profile'), ('name_cn', 'std_no'), ('name_cn',), '新标准')
                if fields['std_no'] and 'XXXX' not in fields['std_no'].upper() and db.query_one('SELECT id FROM standard WHERE std_no = ?', (fields['std_no'],)):
                    raise ApiError(f'标准号 {fields["std_no"]} 已存在，请核对名称和匹配选择')
                fields['std_no'] = fields['std_no'] or None
                sid = db.insert('standard', stamp_update(stamp_create(dict(fields, stage_code='PRE_RESEARCH'))))
                stages.seed_initial(sid, 'PRE_RESEARCH', today())
                counts['created_standards'] += 1
            elif mode != 'skip':
                raise ApiError(f'请决定是否追踪「{source["name_cn"]}」')
            if sid:
                if sid in used:
                    raise ApiError('多个数据包标准匹配到同一主档，请先合并对应纪要')
                used.add(sid)
                old = db.query_one('SELECT note FROM meeting_standard WHERE meeting_id=? AND standard_id=?', (meeting_id, sid))
                note = merge_text(old['note'] if old else '', source['note'])
                db.execute('INSERT INTO meeting_standard(meeting_id,standard_id,note) VALUES(?,?,?) '
                           'ON CONFLICT(meeting_id,standard_id) DO UPDATE SET note=excluded.note', (meeting_id, sid, note))
            else:
                counts['skipped_standards'] += 1
            mapped[source['key']] = sid
        for index, action in enumerate(package['actions']):
            keys = action_keys(action)
            tracked = [key for key in keys if mapped[key]]
            if keys and not tracked:
                counts['excluded_actions'] += 1
                continue
            if index not in keep_new:
                counts['omitted_actions'] += 1
                continue
            sid = mapped[tracked[0]] if len(tracked) == 1 else None
            sources = [s for s in package['standards'] if s['key'] in tracked]
            description = action['description']
            if sources:
                description += '\n\n会议原文标准：' + '；'.join(f'{s["std_no"]} {s["name_cn"]}' for s in sources)
            aid = db.insert('action_item', stamp_update(stamp_create(dict(
                item_no=db.next_serial('action_item', 'item_no', 'AI', today()[:4]),
                item_type='Others', current_status='Open', meeting_id=meeting_id, standard_id=sid,
                title=action['title'], description=description, coordinator=action['owner'] or None,
                target_date=action['due_date'] or None))))
            status.seed_initial('action_item', aid, 'current_status', 'Open', today())
            lookups_service.ensure_values('person', [action['owner']])
            counts['created_actions'] += 1
        for old in action_review['existing_snapshot']:
            if old['id'] not in keep_existing:
                db.delete('action_item', old['id'])
                counts['deleted_actions'] += 1
        db.commit()
        return dict(meeting_id=meeting_id, **counts)
    except Exception:
        db.rollback()
        raise
