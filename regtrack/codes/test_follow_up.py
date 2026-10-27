from testdb import new_database
"""Regression tests for automatic opinions and two independent search fields."""
import tempfile
import unittest
from pathlib import Path
from app import create_app

class FollowUpTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.app = create_app(new_database(initialize=True))
        self.c = self.app.test_client()
        self.headers = {'X-User':'Tester'}
        self.sid = self.c.post('/api/standards',json={'std_no':'GB/T TEST','name_cn':'Battery safety test','stage_code':'DRAFTING'},headers=self.headers).json['id']
        self.did = self.c.post('/api/drafts',json={'standard_id':self.sid,'version_name':'\u8ba8\u8bba\u7a3f','sub_version_no':'1.0','draft_date':'2026-10-12'},headers=self.headers).json['id']

    def note(self, flag=False):
        res=self.c.post(f'/api/drafts/{self.did}/annotations',json={'content':'temperature requirement','annotation_type':'Question','needs_follow_up':flag},headers=self.headers)
        self.assertEqual(res.status_code,201,res.json)
        return res.json

    def opinion(self, note):
        return self.c.get(f'/api/comments/{note["formal_comment_id"]}').json

    def test_automatic_create_and_toggle_without_duplicates(self):
        note=self.note(); cid=note['formal_comment_id']
        self.assertEqual(self.opinion(note)['status'],'Draft')
        for flag, expected in [(True,'Submitted'),(False,'Draft')]:
            res=self.c.put(f'/api/drafts/{self.did}/annotations/{note["id"]}',json={'content':'edited requirement','annotation_type':'Recommendation','needs_follow_up':flag},headers=self.headers)
            self.assertEqual(res.status_code,200,res.json)
            self.assertEqual(res.json['formal_comment_id'],cid)
            row=self.opinion(note)
            self.assertEqual(row['status'],expected)
            self.assertEqual(row['comment_text'],'edited requirement')
        self.assertEqual(self.c.get('/api/comments').json['total'],1)
        self.assertEqual(len(self.opinion(note)['status_history']),3)

    def test_opinion_edit_updates_annotation_and_preserves_processing_status(self):
        note=self.note(True); cid=note['formal_comment_id']
        res=self.c.put(f'/api/comments/{cid}',json={'comment_text':'matrix edit','needs_follow_up':False},headers=self.headers)
        self.assertEqual(res.status_code,200,res.json)
        self.assertEqual(res.json['status'],'Draft')
        self.assertEqual(self.c.get(f'/api/drafts/{self.did}').json['annotations'][0]['content'],'matrix edit')
        res=self.c.put(f'/api/comments/{cid}',json={'needs_follow_up':True,'status_update':{'new_value':'Accepted','effective_date':'2026-10-12','response':'new reply'}},headers=self.headers)
        self.assertEqual(res.status_code,200,res.json)
        self.assertEqual(res.json['needs_follow_up'],1)
        res=self.c.put(f'/api/comments/{cid}',json={'comment_text':'new text','needs_follow_up':True},headers=self.headers)
        self.assertEqual(res.json['status'],'Accepted')

    def test_two_search_fields_cover_content_reply_follow_up_and_intersection(self):
        note=self.note(True); cid=note['formal_comment_id']
        self.c.put(f'/api/comments/{cid}',json={'status_update':{'new_value':'Pending','effective_date':'2026-10-12','response':'unique-reply','follow_up':'unique-followup'}},headers=self.headers)
        for q in ['temperature','unique-reply','unique-followup']:
            self.assertEqual(self.c.get('/api/comments',query_string={'standard_q':'GB/T TEST','content_q':q,'status':'Pending'}).json['total'],1)
        self.assertEqual(self.c.get('/api/comments',query_string={'standard_q':'Battery','content_q':'unique-reply'}).json['total'],1)
        self.assertEqual(self.c.get('/api/comments',query_string={'standard_q':'unmatched','content_q':'unique-reply'}).json['total'],0)

    def test_delete_annotation_cascades_and_invalid_flag_is_rejected(self):
        note=self.note(True)
        res=self.c.post(f'/api/drafts/{self.did}/annotations',json={'content':'invalid','annotation_type':'Proposed Change','needs_follow_up':'yes'},headers=self.headers)
        self.assertEqual(res.status_code,400,res.json)
        self.assertEqual(self.c.delete(f'/api/drafts/{self.did}/annotations/{note["id"]}',headers=self.headers).status_code,200)
        self.assertEqual(self.c.get(f'/api/comments/{note["formal_comment_id"]}').status_code,404)

    def test_matrix_markup_and_obsolete_route_removed(self):
        html=self.c.get('/comments').text
        self.assertIn('id="f-standard-q"',html)
        self.assertIn('id="f-content-q"',html)
        self.assertNotIn('id="btn-new"',html)
        self.assertEqual(self.c.get(f'/api/drafts/{self.did}/annotations/1/comment-draft').status_code,404)

if __name__=='__main__':unittest.main()
