from testdb import new_database
"""Real Access integration for power-loss recovery, checkpoints and run history."""
from datetime import datetime
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from app import create_app
import collection_history as history
import db
import tracking_service as service
from test_tracking import FakePortal, record


class RecoveryTest(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.app=create_app(new_database(initialize=True))
        self.c=self.app.test_client()

    def config(self, **values):
        with self.app.app_context():
            db.update('crawler_settings',1,values)
            db.commit()

    def run_at(self, at, portal=None, session_id=None):
        portal=portal or FakePortal()
        with self.app.app_context(), patch.object(service,'china_now',return_value=at):
            token=service.claim(manual=True,at=at)
            self.assertTrue(token)
            with patch.object(portal,'notices',wraps=portal.notices) as notices:
                result=service.execute_run(token,portal,at=at,session_id=session_id)
                windows=[call.args[2] for call in notices.call_args_list]
        return result,windows

    def startup_at(self, at):
        with self.app.app_context():
            return history.start_session(at)

    def test_default_setting_validation_and_persistence(self):
        self.assertTrue(self.c.get('/api/tracking/settings').json['recovery_enabled'])
        payload=dict(enabled=True,interval_days=1,lookback_days=1,run_time='09:00')
        for value in (None,1,'true'):
            self.assertEqual(self.c.put('/api/tracking/settings',json=dict(payload,recovery_enabled=value)).status_code,400)
        response=self.c.put('/api/tracking/settings',json=dict(payload,recovery_enabled=False))
        self.assertEqual(response.status_code,200,response.json)
        second=create_app(self.app.config['DATABASE'])
        self.assertFalse(second.test_client().get('/api/tracking/settings').json['recovery_enabled'])

    def test_restart_extends_one_day_window_from_last_complete_date(self):
        self.config(lookback_days=1)
        self.run_at(datetime(2026,10,20,9))
        self.config(next_run_at='2026-10-27 09:00:00')
        at=datetime(2026,10,26,8)
        sid=self.startup_at(at)
        config=self.c.get('/api/tracking/settings').json
        self.assertEqual(config['recovery_from'],'2026-10-20')
        self.assertEqual(config['next_run_at'],'2026-10-26 08:00:00')
        standard=self.c.post('/api/standards',json=dict(name_cn='停机期间征求意见标准',stage_code='DRAFTING',stage_effective_date='2026-01-01')).json
        comment=record(number='REC-C',name='停机期间征求意见标准',day='2026-10-23')
        comment['notice_date']='2026-10-23'
        plan=record(number='REC-P',name='停机期间新计划',day='2026-10-24')
        plan['notice_date']='2026-10-24'
        with self.app.app_context(), patch.object(service,'china_now',return_value=at):
            token=service.claim(at=at)
            self.assertTrue(token)
            self.assertIsNone(service.claim(at=at))
            portal=FakePortal(plans=[plan],comments=[comment])
            with patch.object(portal,'notices',wraps=portal.notices) as notices:
                result=service.execute_run(token,portal,at=at,session_id=sid)
                self.assertEqual([c.args[2] for c in notices.call_args_list],[7,7,7])
        self.assertEqual(result,dict(discovered=1,updated=1,errors=[]))
        saved=self.c.get(f'/api/standards/{standard["id"]}').json
        self.assertEqual(saved['stage_code'],'COMMENT_DRAFT')
        self.assertEqual(next(h for h in saved['stage_history'] if h['stage_code']=='COMMENT_DRAFT')['effective_date'],'2026-10-23')
        settings=self.c.get('/api/tracking/settings').json
        self.assertIsNone(settings['recovery_from'])
        self.assertEqual(settings['last_success_date'],'2026-10-26')
        self.assertEqual(settings['last_run']['window_start'],'2026-10-20')
        self.assertTrue(settings['last_run']['is_recovery'])
        self.assertEqual(self.c.get('/api/tracking/summary').json['attention'],2)
        result,windows=self.run_at(datetime(2026,10,26,10),FakePortal(plans=[plan],comments=[comment]))
        self.assertEqual(windows,[1,1,1])
        self.assertEqual(result,dict(discovered=0,updated=0,errors=[]))
        self.assertEqual(self.c.get('/api/tracking/summary').json['all'],2)

    def test_partial_recovery_keeps_anchor_and_retry_keeps_full_gap(self):
        self.config(lookback_days=1)
        self.run_at(datetime(2026,10,20,9))
        self.startup_at(datetime(2026,10,24,8))
        r=record(number='REC-RETRY',day='2026-10-22')
        result,windows=self.run_at(datetime(2026,10,24,8),FakePortal(plans=[r],comments=ValueError('断网')))
        self.assertEqual(windows,[5,5,5])
        self.assertEqual(len(result['errors']),1)
        settings=self.c.get('/api/tracking/settings').json
        self.assertEqual(settings['last_run']['status'],'partial')
        self.assertEqual(settings['last_success_date'],'2026-10-20')
        self.assertEqual(settings['recovery_from'],'2026-10-20')
        self.startup_at(datetime(2026,10,26,8))
        result,windows=self.run_at(datetime(2026,10,26,8),FakePortal(plans=[r]))
        self.assertEqual(windows,[7,7,7])
        self.assertEqual(result['discovered'],0)
        self.assertIsNone(self.c.get('/api/tracking/settings').json['recovery_from'])
        self.assertEqual(self.c.get('/api/tracking/summary').json['plans'],1)

    def test_power_loss_running_log_does_not_advance_checkpoint(self):
        self.config(lookback_days=1)
        self.run_at(datetime(2026,10,20,9))
        with self.app.app_context():
            token=service.claim(manual=True,at=datetime(2026,10,21,9))
            history.begin_run(token,db.query_one('SELECT * FROM crawler_settings WHERE id=1'),datetime(2026,10,21,9),None)
            # No finally/shutdown or finish_run: the persisted shape of a power loss.
        self.startup_at(datetime(2026,10,26,8))
        self.assertEqual(self.c.get('/api/tracking/settings').json['last_success_date'],'2026-10-20')
        self.run_at(datetime(2026,10,26,8))
        with self.app.app_context():
            abandoned=db.query_one('SELECT * FROM crawler_run WHERE lease_owner=%s',(token,))
            self.assertEqual(abandoned['status'],'interrupted')
            self.assertIsNone(abandoned['finished_at'])

    def test_disabled_recovery_keeps_configured_window_and_schedule(self):
        self.config(lookback_days=1,recovery_enabled=0)
        self.run_at(datetime(2026,10,20,9))
        self.config(next_run_at='2026-10-27 09:00:00')
        self.startup_at(datetime(2026,10,26,8))
        settings=self.c.get('/api/tracking/settings').json
        self.assertIsNone(settings['recovery_from'])
        self.assertEqual(settings['next_run_at'],'2026-10-27 09:00:00')
        self.assertEqual(self.run_at(datetime(2026,10,26,8))[1],[1,1,1])

    def test_switch_off_clears_pending_gap(self):
        self.config(lookback_days=1)
        self.run_at(datetime(2026,10,20,9))
        self.startup_at(datetime(2026,10,26,8))
        response=self.c.put('/api/tracking/settings',json=dict(enabled=True,recovery_enabled=False,
            interval_days=1,lookback_days=1,run_time='09:00'))
        self.assertEqual(response.status_code,200,response.json)
        self.assertIsNone(response.json['recovery_from'])
        self.assertEqual(self.run_at(datetime(2026,10,26,8))[1],[1,1,1])

    def test_interrupted_recovery_keeps_success_checkpoint_and_gap(self):
        self.config(lookback_days=1)
        self.run_at(datetime(2026,10,20,9))
        self.startup_at(datetime(2026,10,26,8))
        with self.assertRaises(service.LeaseLost):
            self.run_at(datetime(2026,10,26,8),FakePortal(comments=service.LeaseLost('执行锁失效')))
        settings=self.c.get('/api/tracking/settings').json
        self.assertEqual(settings['last_run']['status'],'interrupted')
        self.assertEqual(settings['last_success_date'],'2026-10-20')
        self.assertEqual(settings['recovery_from'],'2026-10-20')
        self.assertFalse(settings['running'])
        self.assertEqual(self.run_at(datetime(2026,10,27,8))[1],[8,8,8])

    def test_larger_regular_window_is_not_shrunk_by_recovery(self):
        self.config(lookback_days=60)
        self.run_at(datetime(2026,10,20,9))
        self.startup_at(datetime(2026,10,26,8))
        self.assertEqual(self.run_at(datetime(2026,10,26,8))[1],[60,60,60])

    def test_first_start_and_same_day_restart_do_not_invent_a_gap(self):
        sid=self.startup_at(datetime(2026,10,26,8))
        self.assertIsNone(self.c.get('/api/tracking/settings').json['recovery_from'])
        self.run_at(datetime(2026,10,26,9),session_id=sid)
        due=self.c.get('/api/tracking/settings').json['next_run_at']
        self.startup_at(datetime(2026,10,26,10))
        self.assertIsNone(self.c.get('/api/tracking/settings').json['recovery_from'])
        self.assertEqual(self.c.get('/api/tracking/settings').json['next_run_at'],due)
        with self.app.app_context():
            history.stop_session(sid,datetime(2026,10,26,11))
            self.assertEqual(db.query_one('SELECT * FROM crawler_startup WHERE id=%s',(sid,))['stopped_at'],'2026-10-26 11:00:00')

    def test_scheduler_startup_runs_recovery_before_normal_due_time(self):
        self.config(lookback_days=1)
        self.run_at(datetime(2026,10,20,9))
        self.config(next_run_at='2026-10-27 09:00:00')
        collector=self.app.extensions['collection_scheduler']
        # Keep the real start/tick/stop path, dispatch the enqueued job deterministically.
        with patch.object(collector.scheduler,'start',side_effect=lambda:None), patch.object(collector.scheduler,'add_job') as add_job, patch.object(service,'china_now',return_value=datetime(2026,10,26,8)):
            collector.start()
            queued=[c for c in add_job.call_args_list if c.args[0]==collector.run]
            self.assertEqual(len(queued),1)
            with patch('tracking_service.Portal',return_value=FakePortal()):
                collector.run(queued[0].kwargs['args'][0])
            with self.app.app_context():
                run=history.latest_run()
                self.assertEqual(run['window_start'],'2026-10-20')
                self.assertTrue(run['is_recovery'])
            collector.stop()
        self.assertEqual(self.c.get('/api/tracking/settings').json['last_run']['status'],'succeeded')

    def test_disabled_scheduler_does_not_autorun_recovery(self):
        self.config(lookback_days=1,enabled=0)
        self.run_at(datetime(2026,10,20,9))
        self.startup_at(datetime(2026,10,26,8))
        with self.app.app_context():
            self.assertIsNone(service.claim(at=datetime(2026,10,26,8)))
        self.assertEqual(self.run_at(datetime(2026,10,26,8))[1],[7,7,7])

    def test_acknowledged_progress_is_not_notified_again_in_recovery(self):
        standard=self.c.post('/api/standards',json=dict(name_cn='已知悉标准',stage_code='DRAFTING',stage_effective_date='2026-01-01')).json
        r=record(number='REC-ACK',name='已知悉标准',day='2026-10-20')
        r['notice_date']='2026-10-20'
        self.run_at(datetime(2026,10,20,9),FakePortal(comments=[r]))
        m=self.c.get('/api/tracking/notifications?view=comments').json['items'][0]
        self.assertEqual(self.c.post(f'/api/tracking/notifications/{m["id"]}/acknowledge').status_code,200)
        self.startup_at(datetime(2026,10,26,8))
        result,windows=self.run_at(datetime(2026,10,26,8),FakePortal(comments=[r]))
        self.assertEqual(result['updated'],0)
        self.assertEqual(windows,[7,7,7])
        self.assertEqual(self.c.get('/api/tracking/summary').json['attention'],0)
        self.assertEqual(self.c.get('/api/tracking/summary').json['all'],1)


if __name__=='__main__':
    unittest.main()
