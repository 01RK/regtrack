"""Meeting import integration tests against real SQLite schema and API."""
import copy
from contextlib import closing
import json
import io
from pathlib import Path
import sqlite3
import tempfile
import unittest
from app import create_app, init_db
from meeting_import import candidates
from meeting_workbook import SHEETS, read_workbook
from openpyxl import load_workbook
from werkzeug.datastructures import FileStorage

ROOT = Path(__file__).resolve().parents[1]


class MeetingImportTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / 'test.db'
        init_db(self.path, with_seed=False)
        self.client = create_app(self.path).test_client()
        self.packet = {'meeting': {'title': '动力蓄电池性能工作组第二次会议', 'meeting_date': '2026-07-15',
                                  'key_discussions': '循环寿命与性能评价', 'organizer': '测试组织'},
                       'standards': [{'key': 'S1', 'name_cn': '电动汽车动力蓄电池循环寿命要求', 'std_no': 'GB/T 31484', 'note': '讨论循环倍率。'},
                                     {'key': 'S2', 'name_cn': '电动汽车动力蓄电池性能评价指南', 'std_no': '', 'note': '尚无正式标准号。'}],
                       'actions': [{'title': '更新草案', 'description': '按会议意见修订', 'standard_key': 'S1', 'due_date': '2026-09-25'},
                                   {'title': '研究评分', 'description': '研究评分细则', 'standard_key': 'S2'}]}
        self.decision = {'meeting_id': 'new', 'standards': {'S1': {'mode': 'create', 'profile': {'name_cn': self.packet['standards'][0]['name_cn'], 'std_no': 'GB/T 31484'}}, 'S2': {'mode': 'skip'}}, 'confirmed': True}

    def tearDown(self):
        self.tmp.cleanup()

    def rows(self, table):
        with closing(sqlite3.connect(self.path)) as conn:
            conn.row_factory = sqlite3.Row
            return [dict(row) for row in conn.execute(f'SELECT * FROM {table}')]

    def preview(self):
        return self.client.post('/api/meetings/imports/preview', data={'file': (io.BytesIO(self.excel()), 'meeting.xlsx')})

    def excel(self):
        workbook = load_workbook(ROOT / 'static' / 'meeting-import-template.xlsx')
        for name, (_, fields) in SHEETS.items():
            records = [self.packet['meeting']] if name == 'Meeting' else self.packet[name.lower()]
            for i, record in enumerate(records, 3):
                for j, field in enumerate(fields, 1):
                    workbook[name].cell(i, j, record.get(field, ''))
        stream = io.BytesIO()
        workbook.save(stream)
        workbook.close()
        return stream.getvalue()

    def review(self):
        return self.client.post('/api/meetings/imports/review', json={'package': self.packet, 'decision': self.decision})

    def commit(self, actions=None):
        if actions is None:
            reviewed = self.review()
            if reviewed.status_code != 200:
                return reviewed
            r = reviewed.json
            actions = {'existing_snapshot': r['existing_snapshot'],
                       'keep_existing': [int(a['key'].split(':')[1]) for a in r['rows'] if a['origin']=='existing' and a['keep']],
                       'keep_new': [int(a['key'].split(':')[1]) for a in r['rows'] if a['origin']=='new' and a['keep']]}
        self.decision['actions'] = actions
        return self.client.post('/api/meetings/imports', json={'package': self.packet, 'decision': self.decision}, headers={'X-User': 'Tester'})

    def test_read_only_preview_and_assets(self):
        self.assertEqual(self.preview().status_code, 200)
        self.assertEqual(self.rows('meeting'), [])
        for path in ['/meetings/import', '/static/meeting-import-template.xlsx', '/static/meeting-import-prompt.txt']:
            with self.client.get(path) as response:
                self.assertEqual(response.status_code, 200)

    def test_create_tracked_reference_actions_and_history(self):
        result = self.commit()
        self.assertEqual(result.status_code, 201, result.json)
        self.assertEqual(len(self.rows('standard')), 1)
        self.assertEqual(len(self.rows('standard_stage_history')), 1)
        self.assertEqual(len(self.rows('action_status_history')), 1)
        detail = self.client.get(f'/api/meetings/{result.json["meeting_id"]}').json
        self.assertNotIn('references', detail)
        self.assertEqual(len(detail['standards']), 1)
        self.assertEqual(len(detail['actions']), 1)
        actions = self.rows('action_item')
        self.assertIsNotNone(actions[0]['standard_id'])
        self.assertEqual(result.json['excluded_actions'], 1)
        self.assertFalse(any(a['title'] == '研究评分' for a in actions))
        self.assertEqual(actions[0]['created_by'], 'Tester')

    def test_reimport_is_idempotent_and_preserves_manual_notes(self):
        first = self.commit().json
        sid = self.rows('standard')[0]['id']
        self.decision['meeting_id'] = first['meeting_id']
        self.decision['standards']['S1'] = {'mode': 'existing', 'id': sid}
        self.client.put(f'/api/meetings/{first["meeting_id"]}/standards/{sid}', json={'note': '人工批注'})
        for _ in range(2):
            response = self.commit()
            self.assertEqual(response.status_code, 201, response.json)
            self.assertEqual(response.json['omitted_actions'], 1)
        self.assertEqual(len(self.rows('action_item')), 1)
        self.assertEqual(self.rows('meeting_standard')[0]['note'], '人工批注\n\n讨论循环倍率。')

    def test_invalid_decision_rolls_back_everything(self):
        self.decision['standards']['S2'] = {'mode': 'existing', 'id': 999}
        result = self.commit()
        self.assertEqual(result.status_code, 400)
        for table in ['meeting', 'standard', 'meeting_standard', 'lookup_value', 'standard_stage_history', 'action_item']:
            self.assertEqual(self.rows(table), [], table)

    def test_tracking_standards_without_numbers(self):
        self.decision['standards']['S1']['profile']['std_no'] = ''
        self.decision['standards']['S2'] = {'mode': 'create', 'profile': {'name_cn': '性能评价指南', 'std_no': ''}}
        result = self.commit()
        self.assertEqual(result.status_code, 201, result.json)
        self.assertEqual(result.json['created_standards'], 2)
        self.assertTrue(all(s['std_no'] is None for s in self.rows('standard')))
        self.assertEqual(len(self.rows('meeting_standard')), 2)

    def test_multiple_standards_can_share_provisional_number(self):
        self.decision['standards']['S1']['profile']['std_no'] = 'GB/T XXXX'
        self.decision['standards']['S2'] = {'mode': 'create', 'profile': {'name_cn': '性能评价指南', 'std_no': 'GB/T XXXX'}}
        result = self.commit()
        self.assertEqual(result.status_code, 201, result.json)
        self.assertEqual([s['std_no'] for s in self.rows('standard')], ['GB/T XXXX', 'GB/T XXXX'])

    def test_duplicate_formal_number_rolls_back(self):
        self.decision['standards']['S2'] = {'mode': 'create', 'profile': {'name_cn': '性能评价指南', 'std_no': 'GB/T 31484'}}
        self.assertEqual(self.commit().status_code, 400)
        self.assertEqual(self.rows('standard'), [])
        self.assertEqual(self.rows('meeting'), [])

    def test_standard_profile_accepts_empty_number(self):
        for name in ['待立项甲', '待立项乙']:
            result = self.client.post('/api/standards', json={'name_cn': name, 'std_no': '', 'stage_code': 'PRE_RESEARCH'})
            self.assertEqual(result.status_code, 201, result.json)
            self.assertIsNone(result.json['std_no'])

    def test_exchange_and_lifecycle_with_unassigned_numbers(self):
        self.decision['standards']['S1']['profile']['std_no'] = 'GB/T XXXX'
        self.decision['standards']['S2'] = {'mode': 'create', 'profile': {'name_cn': '性能评价指南', 'std_no': 'GB/T XXXX'}}
        for key in ['S3', 'S4']:
            self.packet['standards'].append({'key': key, 'name_cn': f'未编号标准{key}', 'std_no': '', 'note': '讨论测试方法。'})
            self.decision['standards'][key] = {'mode': 'create', 'profile': {'name_cn': f'未编号标准{key}', 'std_no': ''}}
        self.assertEqual(self.commit().status_code, 201)
        sid = next(s['id'] for s in self.rows('standard') if s['std_no'] is None)
        with self.client.get(f'/api/standards/{sid}/lifecycle.md') as response:
            self.assertEqual(response.status_code, 200)
            self.assertNotIn('None', response.data.decode('utf-8'))
        with self.client.get('/api/transfer/export?user=Tester') as response:
            bundle = response.data
        path = Path(self.tmp.name) / 'numbers-exchange.db'
        init_db(path, with_seed=False)
        other = create_app(path).test_client()
        for _ in range(2):
            result = other.post('/api/transfer/import', data={'file': (io.BytesIO(bundle), 'exchange.json'), 'as_user': 'Receiver'})
            self.assertEqual(result.status_code, 200, result.json)
            standards = other.get('/api/standards').json['items']
            self.assertEqual(len(standards), 4)
            self.assertEqual(sum(s['std_no'] is None for s in standards), 2)
            self.assertEqual(sum(s['std_no'] == 'GB/T XXXX' for s in standards), 2)

    def test_matching_threshold_limit_and_date(self):
        title = self.packet['meeting']['title']
        for i in range(5):
            self.client.post('/api/meetings', json={'title': title + str(i), 'meeting_date': '2026-07-15'})
        self.client.post('/api/meetings', json={'title': title, 'meeting_date': '2026-07-16'})
        result = self.preview().json['meetings']
        self.assertEqual(len(result), 6)
        self.assertEqual(sum(m['same_day'] for m in result), 5)
        self.assertEqual(sum(m['similar_title'] for m in result), 3)
        self.assertEqual(len({m['id'] for m in result}), 6)
        rows = [{'id': i, 'name_cn': title + str(i)} for i in range(5)] + [{'id': 9, 'name_cn': '无关内容'}]
        self.assertEqual(len(candidates(title, rows, 'name_cn')), 3)
        self.assertEqual(candidates('abcdefg', [{'id': 1, 'name_cn': 'abcxxxx'}], 'name_cn'), [])

    def test_existing_meeting_keeps_identity_and_appends(self):
        existing = self.client.post('/api/meetings', json={'title': self.packet['meeting']['title'] + '专题', 'meeting_date': '2026-07-15', 'key_discussions': '原有讨论'}).json
        self.decision['meeting_id'] = existing['id']
        self.assertEqual(self.commit().status_code, 201)
        meeting = self.rows('meeting')[0]
        self.assertEqual(meeting['title'], existing['title'])
        self.assertEqual(meeting['key_discussions'], '原有讨论\n\n循环寿命与性能评价')

    def test_same_day_unrelated_and_similar_other_day_are_candidates(self):
        unrelated = self.client.post('/api/meetings', json={'title': '车辆照明专题', 'meeting_date': '2026-07-15'}).json
        similar = self.client.post('/api/meetings', json={'title': self.packet['meeting']['title'], 'meeting_date': '2026-07-16'}).json
        omitted = self.client.post('/api/meetings', json={'title': '材料学讲座', 'meeting_date': '2026-08-01'}).json
        candidates_by_id = {m['id']: m for m in self.preview().json['meetings']}
        self.assertTrue(candidates_by_id[unrelated['id']]['same_day'])
        self.assertFalse(candidates_by_id[unrelated['id']]['similar_title'])
        self.assertTrue(candidates_by_id[similar['id']]['similar_title'])
        self.assertFalse(candidates_by_id[similar['id']]['same_day'])
        self.assertNotIn(omitted['id'], candidates_by_id)
        self.decision['meeting_id'] = similar['id']
        self.assertEqual(self.commit().status_code, 201)
        self.assertEqual(self.client.get(f'/api/meetings/{similar["id"]}').json['meeting_date'], '2026-07-16')

    def reimport_setup(self):
        result = self.commit()
        self.assertEqual(result.status_code, 201, result.json)
        self.decision['meeting_id'] = result.json['meeting_id']
        self.decision['standards']['S1'] = {'mode': 'existing', 'id': self.rows('standard')[0]['id']}
        return self.rows('action_item')[0]

    def action_plan(self, review):
        return {'existing_snapshot': review['existing_snapshot'],
                'keep_existing': [a['id'] for a in review['existing_snapshot']], 'keep_new': []}

    def test_review_lists_new_old_and_defaults_duplicate_to_omit(self):
        old = self.reimport_setup()
        before = self.rows('action_item')
        self.packet['actions'][0]['description'] = '根据最新意见修订草案'
        r = self.review()
        self.assertEqual(r.status_code, 200, r.json)
        self.assertEqual(len(r.json['rows']), 2)
        existing, new = r.json['rows']
        self.assertEqual(existing['key'], f'existing:{old["id"]}')
        self.assertTrue(existing['keep'])
        self.assertFalse(new['keep'])
        self.assertIn(new['key'], existing['duplicates'])
        self.assertEqual(self.rows('action_item'), before)

    def test_user_can_replace_existing_action_with_new_and_remove_history(self):
        old = self.reimport_setup()
        self.packet['actions'][0]['description'] = '更新后的任务说明'
        plan = self.action_plan(self.review().json)
        plan.update(keep_existing=[], keep_new=[0])
        r = self.commit(plan)
        self.assertEqual(r.status_code, 201, r.json)
        self.assertEqual(r.json['deleted_actions'], 1)
        self.assertEqual(r.json['created_actions'], 1)
        self.assertEqual(len(self.rows('action_item')), 1)
        self.assertIn('更新后的任务说明', self.rows('action_item')[0]['description'])
        self.assertNotEqual(self.rows('action_item')[0]['id'], old['id'])
        self.assertEqual(len(self.rows('action_status_history')), 1)

    def test_user_can_explicitly_keep_both_duplicates(self):
        self.reimport_setup()
        plan = self.action_plan(self.review().json)
        plan['keep_new'] = [0]
        r = self.commit(plan)
        self.assertEqual(r.status_code, 201, r.json)
        self.assertEqual(len(self.rows('action_item')), 2)

    def test_deleted_new_action_never_creates_history_or_owner(self):
        self.packet['actions'][0]['owner'] = 'Not Imported'
        plan = self.action_plan(self.review().json)
        r = self.commit(plan)
        self.assertEqual(r.status_code, 201, r.json)
        self.assertEqual(self.rows('action_item'), [])
        self.assertEqual(self.rows('action_status_history'), [])
        self.assertFalse(any(r['value']=='Not Imported' for r in self.rows('lookup_value')))

    def test_delete_old_collect_comments_cascades_feedback_and_history(self):
        self.reimport_setup()
        created = self.client.post('/api/actions', json={'item_type': 'Collect Comments',
            'standard_id': self.rows('standard')[0]['id'], 'meeting_id': self.decision['meeting_id'],
            'title': '收集试验意见', 'description': '向试验组征集意见',
            'recipients': [{'respondent_person': 'Tester'}]})
        self.assertEqual(created.status_code, 201, created.json)
        r = self.review().json
        row = next(a for a in r['rows'] if a['key']==f'existing:{created.json["id"]}')
        self.assertEqual(row['recipient_count'], 1)
        plan = self.action_plan(r)
        plan['keep_existing'].remove(created.json['id'])
        result = self.commit(plan)
        self.assertEqual(result.status_code, 201, result.json)
        self.assertEqual(self.rows('feedback_recipient'), [])
        self.assertEqual(self.rows('recipient_status_history'), [])
        self.assertEqual(len(self.rows('action_status_history')), 1)

    def test_stale_or_foreign_action_selection_is_rejected_atomically(self):
        old = self.reimport_setup()
        plan = self.action_plan(self.review().json)
        plan['keep_existing'] = [9999]
        self.assertEqual(self.commit(plan).status_code, 400)
        plan = self.action_plan(self.review().json)
        updated = self.client.put(f'/api/actions/{old["id"]}', json={'description': '其他窗口修改', 'coordinator': 'Tester'})
        self.assertEqual(updated.status_code, 200, updated.json)
        self.assertEqual(self.commit(plan).status_code, 409)
        self.assertEqual(len(self.rows('action_item')), 1)
        self.assertEqual(self.rows('action_item')[0]['description'], '其他窗口修改')

    def test_same_name_date_prevents_duplicate_meeting(self):
        self.assertEqual(self.commit().status_code, 201)
        self.assertEqual(self.commit().status_code, 400)
        self.assertEqual(len(self.rows('meeting')), 1)

    def test_reference_can_be_promoted_and_actions_relinked(self):
        result = self.commit().json
        self.decision['meeting_id'] = result['meeting_id']
        self.decision['standards']['S1'] = {'mode': 'existing', 'id': self.rows('standard')[0]['id']}
        self.decision['standards']['S2'] = {'mode': 'create', 'profile': {'name_cn': self.packet['standards'][1]['name_cn'], 'std_no': 'TEST-2'}}
        response = self.commit()
        self.assertEqual(response.status_code, 201, response.json)
        self.assertEqual(len(self.rows('meeting_standard')), 2)
        self.assertTrue(all(a['standard_id'] for a in self.rows('action_item')))

    def test_invalid_packets_are_400_and_write_nothing(self):
        original = copy.deepcopy(self.packet)
        mutations = [lambda p: p.update(actions={}), lambda p: p['meeting'].update(meeting_date='2026-02-30'),
                     lambda p: p['meeting'].update(title=2), lambda p: p['meeting'].update(meeting_date='20260715'),
                     lambda p: p['actions'][0].update(standard_key='missing'), lambda p: p['standards'].append(p['standards'][0]),
                     lambda p: p['standards'][0].update(extra='unknown'), lambda p: p['meeting'].update(key_discussions='')]
        for mutate in mutations:
            self.packet = copy.deepcopy(original)
            mutate(self.packet)
            response = self.client.post('/api/meetings/imports', json={'package': self.packet, 'decision': self.decision})
            self.assertEqual(response.status_code, 400, self.packet)
        self.assertEqual(self.rows('meeting'), [])

    def test_reference_material_fixture(self):
        self.packet = read_workbook(FileStorage(stream=io.BytesIO((ROOT / 'docs' / 'meeting-import-example.xlsx').read_bytes()), filename='example.xlsx'))
        self.decision['standards'] = {s['key']: {'mode': 'skip'} for s in self.packet['standards']}
        result = self.commit()
        self.assertEqual(result.status_code, 201, result.json)
        self.assertEqual(self.rows('meeting')[0]['meeting_date'], '2026-07-15')
        self.assertEqual(len(self.rows('meeting_standard')), 0)
        self.assertEqual(len(self.rows('action_item')), 0)
        self.assertEqual(result.json['excluded_actions'], 5)
        self.assertEqual(self.rows('standard'), [])

    def test_exchange_contains_only_tracked_minutes(self):
        self.assertEqual(self.commit().status_code, 201)
        with self.client.get('/api/transfer/export?user=Tester') as response:
            bundle = response.data
        tables = json.loads(bundle)['tables']
        self.assertNotIn('meeting_reference', tables)
        other_path = Path(self.tmp.name) / 'other.db'
        init_db(other_path, with_seed=False)
        other = create_app(other_path).test_client()
        inspected = other.post('/api/transfer/inspect', data={'file': (io.BytesIO(bundle), 'exchange.json')})
        self.assertEqual(inspected.status_code, 200, inspected.json)
        imported = other.post('/api/transfer/import', data={'file': (io.BytesIO(bundle), 'exchange.json'), 'as_user': 'Receiver'})
        self.assertEqual(imported.status_code, 200, imported.json)
        meeting = other.get('/api/meetings').json['items'][0]
        self.assertNotIn('references', meeting)
        self.assertEqual(len(meeting['standards']), 1)

    def test_archived_and_wrong_date_choices_are_rejected(self):
        first = self.commit().json
        sid = self.rows('standard')[0]['id']
        self.decision['meeting_id'] = first['meeting_id']
        self.decision['standards']['S1'] = {'mode': 'existing', 'id': sid}
        self.client.delete(f'/api/standards/{sid}')
        self.assertEqual(self.commit().status_code, 400)
        self.packet['meeting']['meeting_date'] = '2026-07-16'
        self.assertEqual(self.commit().status_code, 400)

    def test_confirmation_and_empty_optional_lists(self):
        self.packet['standards'] = []
        self.packet['actions'] = []
        self.decision['standards'] = {}
        self.decision['confirmed'] = False
        self.assertEqual(self.commit().status_code, 400)
        self.assertEqual(self.rows('meeting'), [])
        self.decision['confirmed'] = True
        self.assertEqual(self.commit().status_code, 201)
        self.assertEqual(self.rows('standard'), [])

    def test_all_untracked_writes_no_actions_or_history_or_owners(self):
        self.packet['actions'][0]['owner'] = 'Excluded Owner'
        self.decision['standards'] = {s['key']: {'mode': 'skip'} for s in self.packet['standards']}
        response = self.commit()
        self.assertEqual(response.status_code, 201, response.json)
        self.assertEqual(response.json['excluded_actions'], 2)
        self.assertEqual(self.rows('action_item'), [])
        self.assertEqual(self.rows('action_status_history'), [])
        self.assertFalse(any(r['value'] == 'Excluded Owner' for r in self.rows('lookup_value')))
        self.assertEqual(self.client.get('/api/actions').json['total'], 0)

    def test_shared_and_meeting_wide_actions(self):
        self.packet['actions'][1]['standard_key'] = 'S1,S2'
        self.packet['actions'].append({'title': '安排下次会议', 'description': '预订会议室', 'standard_key': ''})
        response = self.commit()
        self.assertEqual(response.status_code, 201, response.json)
        self.assertEqual(response.json['created_actions'], 3)
        self.assertIsNotNone(self.rows('action_item')[1]['standard_id'])
        self.assertIsNone(self.rows('action_item')[2]['standard_id'])
        self.assertNotIn(self.packet['standards'][1]['name_cn'], self.rows('action_item')[1]['description'])

    def test_excel_validation_and_removed_json_upload(self):
        for content, filename in [(b'not excel', 'bad.xlsx'), (b'{}', 'bad.json'), (b'x' * (2*1024*1024+1), 'big.xlsx')]:
            r = self.client.post('/api/meetings/imports/preview', data={'file': (io.BytesIO(content), filename)})
            self.assertEqual(r.status_code, 400, r.json)
        r = self.client.post('/api/meetings/imports/preview', json={'package': self.packet})
        self.assertEqual(r.status_code, 400)
        for mutate in [lambda w: setattr(w['Meeting']['A1'], 'value', 'wrong header'),
                       lambda w: setattr(w['Actions']['A3'], 'value', '=1+1'),
                       lambda w: setattr(w['Actions']['C3'], 'value', 'S99'),
                       lambda w: w.create_sheet('Extra'),
                       lambda w: setattr(w['Meeting']['A4'], 'value', 'second meeting')]:
            workbook = load_workbook(io.BytesIO(self.excel()))
            mutate(workbook)
            stream = io.BytesIO(); workbook.save(stream); workbook.close()
            r = self.client.post('/api/meetings/imports/preview', data={'file': (io.BytesIO(stream.getvalue()), 'bad.xlsx')})
            self.assertEqual(r.status_code, 400, r.json)
        self.assertEqual(self.rows('meeting'), [])

    def test_excel_dates_and_reference_fixture_roundtrip(self):
        content = (ROOT / 'docs' / 'meeting-import-example.xlsx').read_bytes()
        r = self.client.post('/api/meetings/imports/preview', data={'file': (io.BytesIO(content), 'example.xlsx')})
        self.assertEqual(r.status_code, 200, r.json)
        self.assertEqual(r.json['package']['meeting']['meeting_date'], '2026-07-15')
        self.assertEqual(r.json['package']['actions'][1]['standard_key'], 'S2,S3')
        self.assertEqual(r.json['package']['actions'][0]['due_date'], '2026-09-25')


if __name__ == '__main__':
    unittest.main()
