"""会议导入的事项核对：新旧对照、重复提醒及最终保留范围。"""
from difflib import SequenceMatcher
import re
import unicodedata

import db
from common import ApiError


def title_key(value):
    return re.sub(r'[\W_]+', '', unicodedata.normalize('NFKC', value).casefold())


def existing_actions(meeting_id):
    if meeting_id == 'new':
        return []
    return db.query('''SELECT a.*, s.std_no, s.name_cn,
        (SELECT COUNT(*) FROM feedback_recipient r WHERE r.action_item_id=a.id) AS recipient_count
        FROM action_item a LEFT JOIN standard s ON s.id=a.standard_id
        WHERE a.meeting_id=? ORDER BY a.id''', (meeting_id,))


def review_actions(package, decision):
    choices = decision.get('standards')
    if not isinstance(choices, dict) or set(choices) != {s['key'] for s in package['standards']}:
        raise ApiError('请逐项确认所有标准')
    if any(not isinstance(c, dict) or c.get('mode') not in ('existing', 'create', 'skip') for c in choices.values()):
        raise ApiError('请决定每项标准是否追踪')
    tracked = {key for key, c in choices.items() if c['mode'] != 'skip'}
    snapshot = existing_actions(decision.get('meeting_id'))
    rows = [dict(key=f'existing:{a["id"]}', origin='existing', title=a['title'],
                 description=a['description'] or '', owner=a['coordinator'] or '',
                 due_date=a['target_date'] or a['submission_due_date'] or a['check_due_date'] or '',
                 standard_names=a['name_cn'] or '会议事项', item_no=a['item_no'],
                 current_status=a['current_status'], recipient_count=a['recipient_count'],
                 keep=True, duplicates=[]) for a in snapshot]
    excluded = 0
    for i, action in enumerate(package['actions']):
        keys = [k.strip() for k in action['standard_key'].split(',') if k.strip()]
        if keys and not tracked.intersection(keys):
            excluded += 1
            continue
        names = [s['name_cn'] for s in package['standards'] if s['key'] in keys and s['key'] in tracked]
        rows.append(dict(action, key=f'new:{i}', origin='new', standard_names='；'.join(names) or '会议事项',
                         item_no=f'新增 {i + 1}', current_status='Open', recipient_count=0, keep=True, duplicates=[]))
    for i, a in enumerate(rows):
        for b in rows[:i]:
            ka, kb = title_key(a['title']), title_key(b['title'])
            if SequenceMatcher(None, ka, kb, autojunk=False).ratio() >= .7:
                a['duplicates'].append(b['key'])
                b['duplicates'].append(a['key'])
                if a['origin'] == 'new' and ka == kb:
                    a['keep'] = False
    return dict(rows=rows, existing_snapshot=snapshot, excluded_actions=excluded)


def validate_action_selection(review, selection):
    if not isinstance(selection, dict) or set(selection) != {'keep_new', 'keep_existing', 'existing_snapshot'}:
        raise ApiError('请先核对新旧事项，再确认导入')
    if selection['existing_snapshot'] != review['existing_snapshot']:
        raise ApiError('会议已有事项已变更，请返回追踪选择并重新核对事项', 409)
    for field, expected in [('keep_new', {int(r['key'].split(':')[1]) for r in review['rows'] if r['origin']=='new'}),
                            ('keep_existing', {a['id'] for a in review['existing_snapshot']})]:
        values = selection[field]
        if not isinstance(values, list) or any(type(v) is not int for v in values) or len(set(values)) != len(values) or not set(values) <= expected:
            raise ApiError('事项保留范围不正确，请重新核对')
    return set(selection['keep_new']), set(selection['keep_existing'])
