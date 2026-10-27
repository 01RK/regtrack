from testdb import new_database
"""Formal opinions support one draft or an ordered pair, with immutable generated source text."""
import io
import json
from pathlib import Path
import tempfile
import unittest

from app import create_app
import db
from dbtest import Database
from constants import ANNOTATION_TYPES


class CommentSourcesTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = new_database(initialize=True)
        self.app = create_app(self.path)
        self.client = self.app.test_client()
        self.headers = {'X-User': 'Tester'}
        self.sid = self.post('/api/standards', {'name_cn': '意见模型测试标准', 'stage_code': 'DRAFTING'}).json['id']
        other = self.post('/api/standards', {'name_cn': '另一标准', 'stage_code': 'DRAFTING'}).json['id']
        self.before = self.post('/api/drafts', {'standard_id': self.sid, 'version_name': '讨论稿', 'sub_version_no': '1.0', 'draft_date': '2026-01-01'}).json['id']
        self.after = self.post('/api/drafts', {'standard_id': self.sid, 'version_name': '征求意见稿', 'sub_version_no': '2.0', 'draft_date': '2026-02-01'}).json['id']
        self.foreign = self.post('/api/drafts', {'standard_id': other, 'version_name': '讨论稿', 'sub_version_no': '1.0', 'draft_date': '2026-01-01'}).json['id']
        with self.app.app_context():
            batch = db.insert('draft_import', {'draft_id': self.after, 'filename': 'test.xlsx', 'source_version': '2.0',
                'source_standard_no': '', 'source_standard_name': '意见模型测试标准', 'created_at': '2026-02-01', 'created_by': 'Tester'})
            self.chapter = db.insert('draft_chapter', {'draft_id': self.after, 'import_batch_id': batch,
                'clause_no': '5.3', 'parent_clause_no': '', 'level': 1, 'sequence': 1, 'title_cn': '试验条件', 'import_key': '5.3'})
            db.commit()

    def post(self, url, payload):
        return self.client.post(url, json=payload, headers=self.headers)

    def packet(self, kind='single'):
        base = dict(standard_id=self.sid, source_kind=kind, comment_type='Proposed Change', comment_text='建议明确试验条件。', submitted_by='Tester')
        if kind == 'single':
            base.update(draft_id=self.after, clause_no='5.3')
        else:
            base.update(before_draft_id=self.before, before_clause_no='5.2', after_draft_id=self.after, after_clause_no='5.3')
        return base

    def test_both_sources_accept_all_types_and_filters(self):
        for kind, channel in [('single', 'Single-draft annotation'), ('comparison', 'Draft comparison annotation')]:
            for category in ANNOTATION_TYPES:
                payload = self.packet(kind); payload['comment_type'] = category
                result = self.post('/api/comments', payload)
                self.assertEqual(result.status_code, 201, result.json)
                self.assertEqual(result.json['submission_channel'], channel)
                self.assertEqual(result.json['comment_type'], category)
                self.assertNotIn('topic', result.json); self.assertNotIn('rationale', result.json)
            result = self.client.get('/api/comments', query_string={'source_kind': kind}).json
            self.assertEqual(result['total'], len(ANNOTATION_TYPES))
        self.assertEqual(self.client.get('/api/comments', query_string={'comment_type': 'Question'}).json['total'], 2)
        self.assertEqual(self.client.get('/api/comments', query_string={'draft_id': self.before}).json['total'], len(ANNOTATION_TYPES))
        self.assertEqual(self.client.get('/api/comments', query_string={'content_q': '建议'}).json['total'], 2 * len(ANNOTATION_TYPES))

    def test_invalid_pairs_and_types_are_rejected_without_writes(self):
        invalid = [dict(before_draft_id=self.after, after_draft_id=self.before),
                   dict(after_draft_id=self.before), dict(after_draft_id=self.foreign),
                   dict(after_draft_id=None), dict(comment_type='Unknown'), dict(draft_id=self.after)]
        for change in invalid:
            with self.subTest(change=change):
                result = self.post('/api/comments', dict(self.packet('comparison'), **change))
                self.assertEqual(result.status_code, 400, result.json)
        self.assertEqual(self.client.get('/api/comments').json['total'], 0)
        self.assertEqual(self.post('/api/comments', dict(self.packet(), before_draft_id=self.before)).status_code, 400)
        self.assertEqual(self.post('/api/comments', dict(self.packet(), draft_id=None)).status_code, 400)

    def test_removed_fields_and_manual_channel_are_rejected(self):
        for key in ['topic', 'rationale', 'submission_channel']:
            result = self.post('/api/comments', dict(self.packet(), **{key: '手动输入'}))
            self.assertEqual(result.status_code, 400, result.json)
            self.assertEqual(result.json['field'], key)
        with Database(self.path) as conn:
            columns = set(conn.columns('comment'))
            self.assertFalse({'topic', 'rationale', 'submission_channel'} & columns)

    def test_source_switch_clears_inactive_reference_and_recalculates_channel(self):
        saved = self.post('/api/comments', self.packet('comparison')).json
        payload = self.packet();payload.update(before_draft_id=None, before_clause_no=None, after_draft_id=None, after_clause_no=None)
        result = self.client.put(f'/api/comments/{saved["id"]}', json=payload)
        self.assertEqual(result.status_code, 200, result.json)
        self.assertEqual(result.json['submission_channel'], 'Single-draft annotation')
        self.assertIsNone(result.json['after_draft_id'])
        self.assertEqual(len(result.json['status_history']), 1)

    def test_whole_and_chapter_annotation_provenance_is_bound_by_server(self):
        for chapter in [None, self.chapter]:
            note = self.post(f'/api/drafts/{self.after}/annotations', dict(content='Please verify temperature',
                annotation_type='Question', chapter_id=chapter, needs_follow_up=True)).json
            result = self.client.get(f'/api/comments/{note["formal_comment_id"]}').json
            self.assertEqual(result['comment_type'], 'Question')
            self.assertEqual(result['clause_no'], '5.3' if chapter else None)
            self.assertEqual(result['status'], 'Submitted')
            changed = self.client.put(f'/api/comments/{result["id"]}', json={'source_kind': 'comparison', 'draft_id': self.before})
            self.assertEqual(changed.status_code, 200, changed.json)
            self.assertEqual(changed.json['draft_id'], self.after)
            self.assertEqual(self.client.get(f'/api/drafts/{self.after}/annotations/{note["id"]}/comment-draft').status_code, 404)

    def test_comparison_snapshot_survives_chapter_replacement_and_draft_reference_rules(self):
        result = self.post('/api/comments', self.packet('comparison')).json
        # A comparison comment is separate from the single-draft replacement snapshot.
        self.assertEqual(self.client.get(f'/api/drafts/{self.after}').json['linked_comments'], [])
        response = self.client.put(f'/api/drafts/{self.before}', json={'standard_id': 2})
        self.assertEqual(response.status_code, 400, response.json)
        self.assertEqual(self.client.delete(f'/api/drafts/{self.before}').status_code, 200)
        self.assertEqual(self.client.get(f'/api/comments/{result["id"]}').status_code, 404)

    def test_exchange_rejects_cross_standard_versions_atomically(self):
        self.assertEqual(self.post('/api/comments', self.packet('comparison')).status_code, 201)
        bundle = json.loads(self.client.get('/api/transfer/export?user=Tester').data)
        bundle['tables']['comment'][0]['after_draft_id'] = self.foreign
        other = create_app(new_database(initialize=True)).test_client()
        result = other.post('/api/transfer/import', data={
            'file': (io.BytesIO(json.dumps(bundle).encode()), 'invalid.json'), 'as_user': 'Tester'})
        self.assertEqual(result.status_code, 400, result.json)
        self.assertEqual(other.get('/api/standards').json['total'], 0)

    def test_exchange_and_lifecycle_preserve_both_versions_and_annotation_link(self):
        pair = self.post('/api/comments', self.packet('comparison'))
        self.assertEqual(pair.status_code, 201, pair.json)
        note = self.post(f'/api/drafts/{self.after}/annotations', {'content': '建议明确边界。', 'annotation_type': 'Recommendation'}).json
        self.assertIsNotNone(note['formal_comment_id'])
        exported = self.client.get('/api/transfer/export?user=Tester')
        self.assertEqual(exported.status_code, 200)
        other = create_app(new_database(initialize=True)).test_client()
        copied = other.post('/api/transfer/import', data={'file': (io.BytesIO(exported.data), 'opinions.json'), 'as_user': 'Tester'})
        self.assertEqual(copied.status_code, 200, copied.json)
        listed = other.get('/api/comments').json
        self.assertEqual(listed['total'], 2)
        rows = [c for g in listed['groups'] for c in g['items']]
        comparative = next(c for c in rows if c['source_kind']=='comparison')
        self.assertEqual(comparative['before_version_name'], '讨论稿')
        self.assertEqual(comparative['after_version_name'], '征求意见稿')
        single = next(c for c in rows if c['source_kind']=='single')
        self.assertIsNotNone(single['source_annotation_id'])
        markdown = other.get(f'/api/standards/{comparative["standard_id"]}/lifecycle.md')
        self.assertEqual(markdown.status_code, 200)
        text = markdown.data.decode()
        self.assertIn('前版草案', text);self.assertIn('Draft comparison annotation', text)
        self.assertNotIn('理由', text)


if __name__ == '__main__':
    unittest.main()
