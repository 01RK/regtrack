from testdb import new_database
"""CATARC adapter + real Access integration and scheduling regressions.
Run: python -m pytest codes/test_tracking.py -q (from regtrack).
Network is replaced by saved public HTML and deterministic test notices.
"""
from datetime import date, datetime, timedelta
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import db
from app import create_app
from catarc_portal import BASE, Portal, parse_listing, parse_notice, parse_notice_date, parse_standard_detail, safe_url
from collection_scheduler import CollectionScheduler
import tracking_service as service

FIXTURES = Path(__file__).resolve().parents[1] / 'tests' / 'fixtures' / 'catarc'


def html(name):
    return (FIXTURES / (name + '.html')).read_bytes()


def record(number='20265058-Q-339', name='测试新立项标准', day=None):
    return dict(number=number, name_cn=name, published_date=day or service.china_now().date().isoformat(),
                source_url=BASE + '/zxd/portal/bzgg/429/jhxdtz', detail_url=BASE+'/zxd/portal/planDetail/201903',
                notice_date=service.china_now().date().isoformat(), effective_date=None, tc_wg='智能网联汽车', leading_org='测试单位甲、测试单位乙')


class FakePortal:
    def __init__(self, **categories):
        self.categories = categories
        self.closed = False

    def notices(self, category, today, lookback_days):
        value = self.categories.get(category, [])
        if isinstance(value, Exception):
            raise value
        for index, row in enumerate(value):
            yield dict(url=f'{BASE}/zxd/portal/{category}/{index}', row=row)

    def records(self, notice, category):
        if isinstance(notice['row'], Exception):
            raise notice['row']
        return [notice['row']]

    def close(self):
        self.closed = True


class PortalTest(unittest.TestCase):
    def test_real_listings_and_detail_tables(self):
        for category, filename, detail, url, number in (
            ('plans', 'plans', 'plan-detail', '/zxd/portal/jhxdtz', '20265058-Q-339'),
            ('comments', 'comments', 'comment-detail', '/zxd/portal/zqyj', '20262948-Q-339'),
            ('releases', 'releases', 'release-detail', '/zxd/portal/bzgg', 'GB 36672-2026')):
            rows, pages = parse_listing(html(filename), BASE+url)
            self.assertEqual(len(rows), 20)
            self.assertGreaterEqual(pages, 1)
            records = parse_notice(html(detail), rows[0], category)
            self.assertEqual(len(records), 1)  # desktop table, not duplicate mobile cards
            self.assertEqual(records[0]['number'], number)
            self.assertTrue(records[0]['name_cn'])
            self.assertIsNotNone(records[0]['detail_url'])
            if category == 'comments':
                self.assertEqual(records[0]['detail_url'],BASE+'/zxd/seekPublicAdvice/std-query-detail?adviceBatchId=935&ybStdProjectId=201890')
        info = parse_standard_detail(html('standard-detail'))
        self.assertEqual(info['plan_no'], '20265058-Q-339')
        self.assertEqual(info['tc_wg'], '智能网联汽车')
        self.assertIn('中国汽车技术研究中心', info['leading_org'])

    def test_publication_window_uses_details_and_stops_all_categories(self):
        today = date(2026,10,26)
        for category in ('plans','comments','releases'):
            for window in (1,3,7,60):
                with self.subTest(category=category,window=window):
                    cutoff = today - timedelta(days=window-1)
                    def listing(ids):
                        items = ''.join(f'<li><a href="/zxd/portal/test/{i}">Notice</a><span class="date">2000-01-01</span></li>' for i in ids)
                        return f"<ul class='list3'>{items}</ul><script>pages: parseInt('3')</script>".encode()
                    def detail(day):
                        if category == 'comments':
                            return f'<div class="zy">发布日期：{day} 截止日期：2099-01-01</div>'.encode()
                        return f'<div class="dialog1"><div class="issue-date">{day}</div></div>'.encode()
                    p=Portal()
                    with patch.object(p,'fetch',side_effect=[listing([1]),detail(today),listing([2,3,4]),detail(cutoff),detail(cutoff-timedelta(days=1))]) as fetch:
                        rows=list(p.notices(category,today,window))
                        self.assertEqual([r['date'] for r in rows],[today.isoformat(),cutoff.isoformat()])
                        self.assertEqual(fetch.call_count,5)
                        self.assertNotIn('/zxd/portal/test/4',[c.args[0] for c in fetch.call_args_list])
                        self.assertNotIn('pageNo=3',' '.join(c.args[0] for c in fetch.call_args_list))
                    p.close()

    def test_real_detail_dates_and_missing_date_is_an_error(self):
        self.assertEqual(parse_notice_date(html('plan-detail'),'plans'),'2026-09-30')
        self.assertEqual(parse_notice_date(html('comment-detail'),'comments'),'2026-10-20')
        self.assertEqual(parse_notice_date(html('release-detail'),'releases'),'2026-09-28')
        for category in ('plans','comments','releases'):
            with self.assertRaises(ValueError):
                parse_notice_date(b'<table><td>2099-01-01</td></table>',category)

    def test_plans_visit_standard_subpage(self):
        p = Portal()
        notice = dict(url=BASE+'/zxd/portal/bzgg/429/jhxdtz', date='2026-09-30', html=html('plan-detail'))
        with patch.object(p, 'fetch', return_value=html('standard-detail')) as fetch:
            rows = p.records(notice, 'plans')
            self.assertEqual(fetch.call_args.args[0], BASE+'/zxd/portal/planDetail/201903')
            self.assertIn('中国汽车技术研究中心', rows[0]['leading_org'])
        p.close()

    def test_changed_structure_and_external_links_fail_visibly(self):
        for value in [b'<html>Login</html>', b'<ul class="list3"></ul>']:
            with self.assertRaises(ValueError):
                parse_listing(value, BASE)
        with self.assertRaises(ValueError):
            parse_notice(b'<html>Login</html>', dict(url=BASE), 'comments')
        with self.assertRaises(ValueError):
            safe_url(BASE, 'https://evil.invalid/path')


class TrackingTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.app = create_app(new_database(initialize=True))
        self.app.config['TESTING'] = True
        self.c = self.app.test_client()

    def run_portal(self, **categories):
        with self.app.app_context():
            token = service.claim(manual=True)
            self.assertTrue(token)
            portal = FakePortal(**categories)
            result = service.execute_run(token, portal)
            self.assertTrue(portal.closed)
            return result

    def inbox(self,view='all'):
        return self.c.get('/api/tracking/notifications',query_string={'view':view}).json

    def create_standard(self, **data):
        payload = dict(name_cn='测试已跟踪标准', stage_code='PROJECT_APPROVAL', stage_effective_date='2025-01-01')
        payload.update(data)
        res = self.c.post('/api/standards', json=payload)
        self.assertEqual(res.status_code, 201, res.json)
        return res.json

    def acknowledge(self, message):
        response = self.c.post(f'/api/tracking/notifications/{message["id"]}/acknowledge',headers={'X-User':'Tester'})
        self.assertEqual(response.status_code,200,response.json)

    def test_new_plan_confirmation_creates_project_approval_once(self):
        r = record()
        self.assertEqual(self.run_portal(plans=[r]),dict(discovered=1,updated=0,errors=[]))
        self.assertEqual(self.run_portal(plans=[r])['discovered'],0)
        message = self.inbox('plans')['items'][0]
        self.assertEqual(self.c.get('/api/standards').json['total'],0)
        self.assertEqual(self.c.post(f'/api/tracking/notifications/{message["id"]}/acknowledge').status_code,409)
        url=f'/api/tracking/candidates/{message["candidate_id"]}/decision'
        response=self.c.post(url,json={'decision':'confirmed'},headers={'X-User':'Tester'})
        self.assertEqual(response.status_code,200,response.json)
        standard=self.c.get(f'/api/standards/{response.json["standard_id"]}').json
        self.assertEqual(standard['stage_code'],'PROJECT_APPROVAL')
        self.assertEqual(standard['plan_no'],r['number'])
        self.assertIsNone(standard['std_no'])
        self.assertEqual(standard['created_by'],'Tester')
        self.assertEqual(standard['leading_org'],'测试单位甲')
        self.assertIn('测试单位乙',standard['scope'])
        self.assertEqual(standard['stage_history'][0]['reference'],r['source_url'])
        self.assertEqual(self.inbox('plans')['total'],0)
        self.assertEqual(self.inbox()['items'][0]['standard_id'],standard['id'])
        self.assertEqual(self.c.get('/api/tracking/summary').json['attention'],0)
        self.assertEqual(self.c.post(url,json={'decision':'confirmed'}).status_code,409)
        self.assertEqual(self.run_portal(plans=[r])['discovered'],0)
        self.assertEqual(self.c.get('/api/standards').json['total'],1)

    def test_new_plan_ignore_reopens_same_message_next_crawl(self):
        self.run_portal(plans=[record()])
        message=self.inbox('plans')['items'][0]
        response=self.c.post(f'/api/tracking/candidates/{message["candidate_id"]}/decision',json={'decision':'ignored'})
        self.assertEqual(response.status_code,200,response.json)
        self.assertEqual(self.inbox('plans')['total'],0)
        self.assertEqual(self.run_portal(plans=[record()])['discovered'],1)
        reopened=self.inbox('plans')['items'][0]
        self.assertEqual(reopened['id'],message['id'])
        self.assertFalse(reopened['is_read'])
        self.assertIsNone(reopened['acknowledged_by'])
        self.assertEqual(self.run_portal(plans=[record()])['discovered'],0)
        self.assertEqual(self.c.get('/api/standards').json['total'],0)

    def test_existing_preresearch_automatically_advances_and_requires_acknowledgment(self):
        r=record()
        standard=self.create_standard(plan_no=r['number'],stage_code='PRE_RESEARCH')
        result=self.run_portal(plans=[r])
        self.assertEqual(result,dict(discovered=0,updated=1,errors=[]))
        saved=self.c.get(f'/api/standards/{standard["id"]}').json
        self.assertEqual(saved['stage_code'],'PROJECT_APPROVAL')
        self.assertEqual(len(saved['stage_history']),2)
        message=self.inbox('plans')['items'][0]
        self.assertIsNone(message['candidate_id'])
        self.assertEqual((message['previous_stage'],message['target_stage']),('PRE_RESEARCH','PROJECT_APPROVAL'))
        self.assertFalse(message['is_read'])
        self.assertEqual(self.run_portal(plans=[r])['updated'],0)
        self.assertEqual(self.inbox('plans')['total'],1)
        self.c.get('/notifications')
        self.c.get('/api/tracking/notifications?view=plans')
        self.assertEqual(self.c.get('/api/tracking/summary').json['attention'],1)
        self.acknowledge(message)
        self.assertEqual(self.inbox('plans')['total'],0)
        archived=self.inbox()['items'][0]
        self.assertTrue(archived['is_read'])
        self.assertEqual(archived['acknowledged_by'],'Tester')
        self.assertEqual(self.run_portal(plans=[r])['updated'],0)
        self.assertEqual(self.inbox()['total'],1)

    def test_consultation_then_release_update_before_acknowledgment(self):
        standard=self.create_standard(plan_no='20265058-Q-339')
        sid=standard['id']
        comment=record(name='改名后的标准',day='2026-09-01')
        self.assertEqual(self.run_portal(comments=[comment])['updated'],1)
        self.assertEqual(self.c.get(f'/api/standards/{sid}').json['stage_code'],'COMMENT_DRAFT')
        message=self.inbox('comments')['items'][0]
        self.assertIsNone(message['candidate_id'])
        self.assertFalse(message['is_read'])
        self.assertEqual(self.inbox('plans')['total'],0)
        self.acknowledge(message)
        self.assertEqual(self.inbox('comments')['total'],0)
        release=record(number='GB 55555-2026',name=standard['name_cn'],day='2026-10-20')
        release['effective_date']='2027-01-01'
        self.assertEqual(self.run_portal(releases=[release])['updated'],1)
        saved=self.c.get(f'/api/standards/{sid}').json
        self.assertEqual(saved['stage_code'],'RELEASED')
        self.assertEqual(saved['actual_release_date'],'2026-10-20')
        self.assertEqual(saved['effective_date'],'2027-01-01')
        self.assertEqual(saved['std_no'],'GB 55555-2026')
        self.assertEqual(saved['plan_no'],'20265058-Q-339')
        self.assertEqual(len(saved['stage_history']),3)
        message=self.inbox('releases')['items'][0]
        self.assertEqual(message['target_stage'],'RELEASED')
        self.assertEqual(self.run_portal(comments=[comment],releases=[release])['updated'],0)
        self.assertEqual(self.inbox('releases')['total'],1)
        self.acknowledge(message)
        self.assertEqual(self.inbox('releases')['total'],0)
        self.assertEqual(self.inbox()['total'],2)
        self.assertEqual(self.c.get('/api/tracking/summary').json['attention'],0)

    def test_each_acknowledgment_only_archives_one_message(self):
        self.create_standard(name_cn='标准甲',stage_code='DRAFTING')
        self.create_standard(name_cn='标准乙',stage_code='PRE_RESEARCH')
        self.run_portal(comments=[record(number='A',name='标准甲'),record(number='B',name='标准乙')])
        messages=self.inbox('comments')['items']
        self.assertEqual(len(messages),2)
        self.acknowledge(messages[0])
        self.assertEqual(self.inbox('comments')['total'],1)
        self.assertEqual(self.c.get('/api/tracking/summary').json['attention'],1)
        self.assertEqual(self.c.post('/api/tracking/notifications/read-all').status_code,404)
        self.assertEqual(self.c.post(f'/api/tracking/notifications/{messages[1]["id"]}/read').status_code,404)
        self.assertEqual(self.c.get('/api/tracking/notifications?view=unread').status_code,400)
        self.assertEqual(self.c.get('/api/tracking/notifications?view=pending').status_code,400)

    def test_pending_plan_becomes_automatic_when_profile_created_between_crawls(self):
        r=record()
        self.run_portal(plans=[r])
        original=self.inbox('plans')['items'][0]
        standard=self.create_standard(name_cn=r['name_cn'],stage_code='PRE_RESEARCH')
        self.assertEqual(self.run_portal(plans=[r])['updated'],1)
        message=self.inbox('plans')['items'][0]
        self.assertEqual(message['id'],original['id'])
        self.assertEqual(message['decision'],'confirmed')
        self.assertEqual(message['standard_id'],standard['id'])
        self.assertEqual(message['target_stage'],'PROJECT_APPROVAL')
        self.assertEqual(self.c.get(f'/api/standards/{standard["id"]}').json['stage_code'],'PROJECT_APPROVAL')
        self.assertEqual(self.c.post(f'/api/tracking/candidates/{original["candidate_id"]}/decision',json={'decision':'confirmed'}).status_code,409)
        self.acknowledge(message)

    def test_untracked_archived_and_advanced_standards_not_updated(self):
        archived = self.create_standard(plan_no='20260001-Q-339')
        self.c.post(f'/api/standards/{archived["id"]}/archive')
        released = self.create_standard(name_cn='已实施标准',std_no='GB 22222-2025',stage_code='IMPLEMENTED')
        records = [record(number='20260001-Q-339'),record(number='GB 22222-2025',name='已实施标准'),record(number='20269999-Q-339',name='不在系统中的标准')]
        self.assertEqual(self.run_portal(comments=records, releases=records)['updated'],0)
        self.assertEqual(self.run_portal(plans=[records[0]])['discovered'],0)
        self.assertEqual(self.c.get(f'/api/standards/{released["id"]}').json['stage_code'],'IMPLEMENTED')

    def test_old_same_name_release_does_not_release_new_project(self):
        s = self.create_standard(name_cn='修订标准',stage_effective_date='2026-10-25')
        self.assertEqual(self.run_portal(releases=[record(number='GB 12345-2020',name='修订标准',day='2020-01-01')])['updated'],0)
        self.assertEqual(self.c.get(f'/api/standards/{s["id"]}').json['stage_code'],'PROJECT_APPROVAL')

    def test_full_name_only_and_ambiguous_matching_is_reported(self):
        self.create_standard(name_cn='汽车 制动系统 第1部分')
        self.assertEqual(self.run_portal(comments=[record(name='汽车 制动系统')])['updated'],0)
        self.create_standard(name_cn='汽车 制动系统 第1部分')
        result = self.run_portal(comments=[record(name='汽车 制动系统 第1部分')])
        self.assertIn('不唯一',result['errors'][0])
        self.assertEqual(self.inbox()['items'][0]['kind'],'error')

    def test_confirmation_merges_concurrently_created_profile(self):
        r = record()
        self.run_portal(plans=[r])
        candidate = self.inbox('plans')['items'][0]['candidate_id']
        s = self.create_standard(name_cn=r['name_cn'],stage_code='DRAFTING')
        res = self.c.post(f'/api/tracking/candidates/{candidate}/decision',json={'decision':'confirmed'})
        self.assertEqual(res.status_code,200,res.json)
        self.assertEqual(res.json['standard_id'],s['id'])
        saved = self.c.get(f'/api/standards/{s["id"]}').json
        self.assertEqual(saved['stage_code'],'DRAFTING')
        self.assertEqual(saved['plan_no'],r['number'])
        self.assertEqual(self.c.get('/api/standards').json['total'],1)

    def test_partial_failures_continue_and_retry_without_duplicate_error_messages(self):
        good = record()
        result = self.run_portal(plans=[ValueError('详情不可用'),good],comments=ValueError('列表不可用'))
        self.assertEqual(result['discovered'],1)
        self.assertEqual(len(result['errors']),2)
        self.run_portal(plans=[ValueError('详情不可用'),good],comments=ValueError('列表不可用'))
        self.assertEqual(len([r for r in self.inbox()['items'] if r['kind']=='error']),1)
        self.assertEqual(self.c.get('/api/tracking/settings').json['running'],False)

    def test_all_categories_receive_saved_window(self):
        self.c.put('/api/tracking/settings',json=dict(recovery_enabled=True,enabled=True,interval_days=1,lookback_days=3,run_time='09:00'))
        with self.app.app_context():
            portal=FakePortal()
            with patch.object(portal,'notices',wraps=portal.notices) as notices:
                service.execute_run(service.claim(manual=True),portal)
                self.assertEqual([c.args[2] for c in notices.call_args_list],[3,3,3])

    def test_expired_details_stop_before_parsing_tables_or_following_links(self):
        today=date(2026,10,26)
        listing=b"<ul class='list3'><li><a href='/zxd/portal/test/old'>Old</a><span class='date'>2026-10-26</span></li><li><a href='/zxd/portal/test/later'>Later</a><span class='date'>2026-10-26</span></li></ul><script>pages: parseInt('2')</script>"
        issued=b'<div class="dialog1"><div class="issue-date">2026-10-23</div><a href="/must-not-fetch">Expired standard</a></div>'
        comment='<div class="zy">发布日期：2026-10-23</div>'.encode()
        self.c.put('/api/tracking/settings',json=dict(recovery_enabled=True,enabled=True,interval_days=1,lookback_days=3,run_time='09:00'))
        with self.app.app_context():
            portal=Portal()
            with patch.object(portal,'fetch',side_effect=[listing,issued,listing,comment,listing,issued]) as fetch:
                result=service.execute_run(service.claim(manual=True),portal,at=datetime(2026,10,26,12))
                self.assertEqual(fetch.call_count,6)
                self.assertNotIn('/zxd/portal/test/later',[c.args[0] for c in fetch.call_args_list])
            self.assertEqual(result,dict(discovered=0,updated=0,errors=[]))

    def test_empty_and_successful_runs_do_not_generate_completion_messages(self):
        self.run_portal()
        self.assertEqual(self.inbox()['items'],[])
        self.assertEqual(self.c.get('/api/tracking/summary').json['attention'],0)
        self.run_portal(plans=[record()])
        self.assertEqual(self.inbox()['total'],1)
        self.assertEqual(self.inbox()['items'][0]['kind'],'plans')
        self.assertTrue(self.c.get('/api/tracking/settings').json['enabled'])

    def test_source_links_point_to_details(self):
        r=record()
        self.run_portal(plans=[r])
        self.assertEqual(self.inbox('plans')['items'][0]['source_url'],r['detail_url'])
        standard=self.create_standard(name_cn='测试已跟踪标准')
        self.run_portal(comments=[record(name='测试已跟踪标准')])
        stage=next(r for r in self.inbox()['items'] if r['kind']=='comments')
        self.assertEqual(stage['source_url'],r['detail_url'])

    def test_inbox_filters_pagination_default_and_badge(self):
        self.assertEqual(self.c.get('/api/tracking/summary').json,
                         dict(plans=0,comments=0,releases=0,all=0,attention=0,pending=0))
        with self.app.app_context():
            for index in range(21):
                service.notify('comments',f'标准 {index}')
            db.commit()
        self.assertEqual(self.c.get('/api/tracking/notifications').json['view'],'comments')
        self.assertEqual(len(self.inbox('comments')['items']),20)
        page=self.c.get('/api/tracking/notifications?view=comments&page=99').json
        self.assertEqual(page['page'],2)
        self.assertEqual(len(page['items']),1)
        self.acknowledge(page['items'][0])
        page=self.c.get('/api/tracking/notifications?view=comments&page=2').json
        self.assertEqual(page['page'],1)
        self.assertEqual(page['total'],20)
        self.assertEqual(self.inbox()['total'],21)
        self.assertEqual(self.c.get('/api/tracking/summary').json['attention'],20)
        self.assertEqual(self.c.get('/api/tracking/notifications?view=unknown').status_code,400)
        self.assertEqual(self.c.post('/api/tracking/notifications/999/acknowledge').status_code,404)

    def test_multiple_clients_share_claim_and_notifications(self):
        second = create_app(self.app.config['DATABASE'])
        with self.app.app_context():
            token = service.claim(manual=True)
        with second.app_context():
            self.assertIsNone(service.claim(manual=True))
            service.execute_run(token,FakePortal(plans=[record()]))
        self.assertEqual(self.c.get('/api/tracking/summary').json['pending'],1)
        self.assertEqual(second.test_client().get('/api/tracking/summary').json['pending'],1)

    def test_lost_lease_cannot_write_results_or_candidates(self):
        with self.app.app_context():
            old = service.claim(manual=True)
            db.update('crawler_settings',1,dict(lease_until='2000-01-01 00:00:00'))
            db.commit()
            new = service.claim(manual=True)
            with self.assertRaises(service.LeaseLost):
                service.execute_run(old,FakePortal(plans=[record()]))
            self.assertEqual(db.query_one('SELECT lease_owner FROM crawler_settings WHERE id = 1')['lease_owner'],new)
        self.assertEqual(self.c.get('/api/tracking/summary').json['pending'],0)

    def test_schedule_configuration_validation_and_persistence(self):
        for payload in [dict(enabled=1,interval_days=1,lookback_days=7,run_time='09:00'), dict(recovery_enabled=True,enabled=True,interval_days=0,run_time='09:00'),dict(recovery_enabled=True,enabled=True,interval_days=1.5,run_time='09:00'), dict(recovery_enabled=True,enabled=True,interval_days=1,run_time='24:00')]:
            self.assertEqual(self.c.put('/api/tracking/settings',json=payload).status_code,400)
        at = datetime(2026,10,26,10)
        with patch.object(service,'china_now',return_value=at):
            response = self.c.put('/api/tracking/settings',json=dict(recovery_enabled=True,enabled=True,interval_days=3,lookback_days=3,run_time='08:30'))
        self.assertEqual(response.status_code,200,response.json)
        self.assertEqual(response.json['next_run_at'],'2026-10-29 08:30:00')
        second = create_app(self.app.config['DATABASE'])
        self.assertEqual(second.test_client().get('/api/tracking/settings').json['interval_days'],3)
        self.assertEqual(second.test_client().get('/api/tracking/settings').json['lookback_days'],3)
        for window in (0,-1,3651,2.5,True,'3',None):
            self.assertEqual(self.c.put('/api/tracking/settings',json=dict(recovery_enabled=True,enabled=True,interval_days=1,lookback_days=window,run_time='09:00')).status_code,400)
        self.assertEqual(self.c.put('/api/tracking/settings',json=dict(recovery_enabled=True,enabled=False,interval_days=3,lookback_days=3,run_time='08:30')).json['next_run_at'],None)

    def test_custom_sixty_day_range_is_saved_and_used(self):
        payload=dict(recovery_enabled=True,enabled=True,interval_days=1,lookback_days=60,run_time='09:00')
        response=self.c.put('/api/tracking/settings',json=payload)
        self.assertEqual(response.status_code,200,response.json)
        second=create_app(self.app.config['DATABASE'])
        self.assertEqual(second.test_client().get('/api/tracking/settings').json['lookback_days'],60)
        with self.app.app_context():
            portal=FakePortal()
            with patch.object(portal,'notices',wraps=portal.notices) as notices:
                service.execute_run(service.claim(manual=True),portal)
                self.assertEqual([c.args[2] for c in notices.call_args_list],[60,60,60])

    def test_shared_claim_and_crash_recovery(self):
        at = service.china_now()
        with self.app.app_context():
            token = service.claim(manual=True,at=at)
            self.assertTrue(token)
            self.assertIsNone(service.claim(manual=True,at=at))
            expired = service.claim(manual=True,at=at+timedelta(minutes=6))
            self.assertTrue(expired)
            with self.assertRaises(RuntimeError):
                service.heartbeat(token)
            self.assertEqual(db.query_one('SELECT lease_owner FROM crawler_settings WHERE id = 1')['lease_owner'],expired)

    def test_restart_catches_up_due_schedule_once(self):
        at = datetime(2026,10,26,10)
        with self.app.app_context():
            db.update('crawler_settings',1,dict(next_run_at='2026-10-25 09:00:00'))
            db.commit()
            token = service.claim(at=at)
            self.assertTrue(token)
            self.assertIsNone(service.claim(at=at))
            with patch.object(service,'china_now',return_value=at):
                service.execute_run(token,FakePortal(),at=at)
            self.assertEqual(service.settings()['next_run_at'],'2026-10-27 09:00:00')
            self.assertIsNone(service.claim(at=at))

    def test_disabled_schedule_manual_run_and_api_dispatch(self):
        self.c.put('/api/tracking/settings',json=dict(recovery_enabled=True,enabled=False,interval_days=1,lookback_days=7,run_time='09:00'))
        with self.app.app_context():
            self.assertIsNone(service.claim())
        self.assertEqual(self.c.post('/api/tracking/run').status_code,503)
        collector = self.app.extensions['collection_scheduler']
        collector.scheduler.start(paused=True)
        try:
            response = self.c.post('/api/tracking/run')
            self.assertEqual(response.status_code,202,response.json)
            self.assertEqual(self.c.post('/api/tracking/run').status_code,409)
            job = collector.scheduler.get_jobs()[0]
            with patch('tracking_service.Portal',return_value=FakePortal()):
                job.func(*job.args)
            self.assertFalse(self.c.get('/api/tracking/settings').json['running'])
            self.assertIsNone(self.c.get('/api/tracking/settings').json['next_run_at'])
        finally:
            collector.stop()


if __name__ == '__main__':
    unittest.main()
