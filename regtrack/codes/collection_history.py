"""Durable startup/run history and the single pending outage recovery window."""
from datetime import date, timedelta
import json

import db


def stamp(at):
    return at.strftime('%Y-%m-%d %H:%M:%S')


def latest_success():
    return db.query_one("SELECT id, window_end, finished_at FROM crawler_run "
                        "WHERE status = 'succeeded' ORDER BY id DESC LIMIT 1")


def latest_run():
    return db.query_one('SELECT id, started_at, finished_at, window_start, window_end, '
                        'is_recovery, status FROM crawler_run ORDER BY id DESC LIMIT 1')


def start_session(at):
    session_id = db.insert('crawler_startup', dict(started_at=stamp(at)))
    config = db.query_one('SELECT * FROM crawler_settings WHERE id = 1')
    success = latest_success()
    if config['recovery_enabled'] and success and success['window_end'] < at.date().isoformat():
        start = min(config['recovery_from'] or success['window_end'], success['window_end'])
        update = dict(recovery_from=start)
        if config['enabled']:
            update['next_run_at'] = min(config['next_run_at'] or stamp(at), stamp(at))
        db.update('crawler_settings', 1, update)
    db.commit()
    return session_id


def stop_session(session_id, at):
    db.update('crawler_startup', session_id, dict(stopped_at=stamp(at)))
    db.commit()


def begin_run(token, config, at, session_id):
    start = at.date() - timedelta(days=config['lookback_days'] - 1)
    recovery = bool(config['recovery_enabled'] and config['recovery_from'])
    if recovery:
        start = min(start, date.fromisoformat(config['recovery_from']))
    # A new lease proves that any older running task no longer owns execution.
    db.execute("UPDATE crawler_run SET status = 'interrupted' WHERE status = 'running'")
    window = dict(window_start=start.isoformat(), window_end=at.date().isoformat(), is_recovery=int(recovery))
    db.insert('crawler_run', dict(window, lease_owner=token, startup_id=session_id,
              started_at=stamp(at), status='running'))
    db.commit()
    return window


def finish_run(token, window, result, at):
    status = 'partial' if result['errors'] else 'succeeded'
    db.execute('UPDATE crawler_run SET status = %s, finished_at = %s, result = %s WHERE lease_owner = %s',
               (status, stamp(at), json.dumps(result, ensure_ascii=False), token))
    if status == 'succeeded':
        # Clear only a gap actually covered by this completed run.
        db.execute('UPDATE crawler_settings SET recovery_from = NULL WHERE id = 1 '
                   'AND recovery_from >= %s AND recovery_from <= %s',
                   (window['window_start'], window['window_end']))


def fail_run(token, error, at, *, interrupted=False):
    db.execute('UPDATE crawler_run SET status = %s, finished_at = %s, result = %s WHERE lease_owner = %s',
               ('interrupted' if interrupted else 'failed', stamp(at),
                json.dumps(dict(errors=[str(error)]), ensure_ascii=False), token))
