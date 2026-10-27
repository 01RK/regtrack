"""Shared collection state, idempotent matching, notifications and tracking decisions."""
from datetime import datetime, timedelta, timezone
import json
import re
import unicodedata
from uuid import uuid4

import db
import collection_history as history
import stages
from catarc_portal import Portal
from common import ApiError, current_user, now
from constants import STAGE_ORDER

CHINA = timezone(timedelta(hours=8))
BOT = '中汽中心自动采集'


class LeaseLost(RuntimeError):
    pass


def china_now():
    return datetime.now(CHINA).replace(tzinfo=None, microsecond=0)


def stamp(dt):
    return dt.strftime('%Y-%m-%d %H:%M:%S')


def settings():
    row = db.query_one('SELECT * FROM crawler_settings WHERE id = 1')
    row['running'] = bool(row['lease_until'] and row['lease_until'] > stamp(china_now()))
    row['last_result'] = json.loads(row['last_result']) if row['last_result'] else None
    row.pop('lease_owner')
    success = history.latest_success()
    row['last_success_at'] = success['finished_at'] if success else None
    row['last_success_date'] = success['window_end'] if success else None
    row['last_run'] = history.latest_run()
    return row


def next_time(config, at, *, include_today=False):
    hour, minute = map(int, config['run_time'].split(':'))
    due = at.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if due <= at and not include_today:
        due += timedelta(days=config['interval_days'])
    return due


def save_settings(payload):
    enabled, days, run_time = payload.get('enabled'), payload.get('interval_days'), payload.get('run_time')
    if not isinstance(enabled, bool):
        raise ApiError('请选择是否启用定时采集', field='enabled')
    if type(days) is not int or not 1 <= days <= 365:
        raise ApiError('采集间隔必须是 1 到 365 的整数', field='interval_days')
    if not isinstance(run_time, str) or not re.fullmatch(r'(?:[01]\d|2[0-3]):[0-5]\d', run_time):
        raise ApiError('采集时间必须为 HH:MM（24 小时制）', field='run_time')
    recovery = payload.get('recovery_enabled')
    if not isinstance(recovery, bool):
        raise ApiError('请选择是否启用服务器中断补采', field='recovery_enabled')
    lookback = payload.get('lookback_days')
    if type(lookback) is not int or not 1 <= lookback <= 3650:
        raise ApiError('通知范围必须是 1 到 3650 的整数天', field='lookback_days')
    data = dict(enabled=int(enabled), recovery_enabled=int(recovery), interval_days=days, run_time=run_time, lookback_days=lookback)
    if not recovery:
        data['recovery_from'] = None
    data['next_run_at'] = stamp(next_time(data, china_now())) if enabled else None
    db.update('crawler_settings', 1, data)
    db.commit()
    return settings()


def claim(manual=False, at=None):
    at = at or china_now()
    config = db.query_one('SELECT * FROM crawler_settings WHERE id = 1')
    if not manual:
        if not config['enabled']:
            return None
        if not config['next_run_at']:
            due = stamp(next_time(config, at, include_today=True))
            db.execute('UPDATE crawler_settings SET next_run_at = %s '
                       'WHERE id = 1 AND enabled = 1 AND next_run_at IS NULL', (due,))
            db.commit()
            config['next_run_at'] = due
        if config['next_run_at'] > stamp(at):
            return None
    token = str(uuid4())
    where = '' if manual else ' AND enabled = 1 AND next_run_at <= %s'
    params = [token, stamp(at + timedelta(minutes=5)), stamp(at), stamp(at)]
    if not manual:
        params.append(stamp(at))
    count = db.execute('UPDATE crawler_settings SET lease_owner = %s, lease_until = %s, last_started_at = %s '
                       'WHERE id = 1 AND (lease_until IS NULL OR lease_until <= %s)' + where, params).rowcount
    db.commit()
    return token if count == 1 else None


def heartbeat(token):
    count = db.execute('UPDATE crawler_settings SET lease_until = %s WHERE id = 1 AND lease_owner = %s',
                       (stamp(china_now() + timedelta(minutes=5)), token)).rowcount
    db.commit()
    if count != 1:
        raise LeaseLost('采集任务的执行锁已失效')


def notify(kind, title, body='', **data):
    return db.insert('notification', dict(kind=kind, title=title, body=body,
        is_read=0, created_at=now(), **data))


def normalized(value):
    return re.sub(r'\s+', '', unicodedata.normalize('NFKC', value or '')).replace('—', '-').replace('–', '-')


def match_standard(record, include_archived=False):
    clause = '' if include_archived else ' WHERE archived_at IS NULL'
    rows = db.query('SELECT id, plan_no, std_no, name_cn, stage_code, archived_at FROM standard' + clause)
    number = normalized(record['number'])
    matched = [s for s in rows if number in (normalized(s['plan_no']), normalized(s['std_no']))]
    match_kind = 'number' if matched else 'name'
    if not matched:
        matched = [s for s in rows if normalized(s['name_cn']) == normalized(record['name_cn'])]
    if len(matched) > 1:
        raise ValueError(f'标准匹配不唯一，请核对主档编号：{record["number"]} {record["name_cn"]}')
    if matched:
        matched[0]['match_kind'] = match_kind
    return matched[0] if matched else None


def discover(record):
    standard = match_standard(record, include_archived=True)
    if standard:
        return 0, int(advance(record, 'plans')) if not standard['archived_at'] else 0
    key = 'project:' + normalized(record['number'])
    candidate = db.query_one('SELECT * FROM tracking_candidate WHERE source_key = %s', (key,))
    if candidate and candidate['decision'] != 'ignored':
        return 0, 0
    source = record['detail_url'] or record['source_url']
    data = dict(source_key=key, source_number=record['number'], name_cn=record['name_cn'],
                source_url=source, published_date=record['notice_date'],
                payload=json.dumps(record, ensure_ascii=False), decision='pending',
                decided_by=None, decided_at=None, created_at=now())
    message = dict(title=record['name_cn'], body='计划已下达，确认后按立项建档。',
                   source_url=source, source_number=record['number'], published_date=record['notice_date'])
    if candidate:
        db.update('tracking_candidate', candidate['id'], data)
        existing = db.query_one('SELECT id FROM notification WHERE candidate_id = %s', (candidate['id'],))
        db.update('notification', existing['id'], dict(message, is_read=0, created_at=now(),
                  acknowledged_by=None, acknowledged_at=None))
    else:
        candidate_id = db.insert('tracking_candidate', data)
        notify('plans', candidate_id=candidate_id, **message)
    return 1, 0


def advance(record, category):
    standard = match_standard(record)
    code = {'plans':'PROJECT_APPROVAL', 'comments':'COMMENT_DRAFT', 'releases':'RELEASED'}[category]
    if not standard or STAGE_ORDER[standard['stage_code']] >= STAGE_ORDER[code]:
        return False
    first = db.query_one('SELECT MIN(effective_date) AS first_date FROM standard_stage_history WHERE standard_id = %s',
                         (standard['id'],))['first_date']
    if standard['match_kind'] == 'name' and first and record['published_date'] < first:
        return False
    if record['published_date'] > china_now().date().isoformat():
        return False
    apply_stage(standard, record, code)
    message = dict(title=record['name_cn'], body='已自动更新标准状态。', standard_id=standard['id'],
                   source_number=record['number'], published_date=record['notice_date'],
                   previous_stage=standard['stage_code'], target_stage=code,
                   source_url=record['detail_url'] or record['source_url'])
    # A profile may have been created while its project message was pending.
    candidate = db.query_one('SELECT id FROM tracking_candidate WHERE source_key = %s',
                             ('project:' + normalized(record['number']),)) if category == 'plans' else None
    if candidate:
        db.update('tracking_candidate', candidate['id'], dict(decision='confirmed', decided_by=BOT, decided_at=now()))
        message_id = db.query_one('SELECT id FROM notification WHERE candidate_id = %s', (candidate['id'],))['id']
        db.update('notification', message_id, dict(message, is_read=0, created_at=now(),
                  acknowledged_by=None, acknowledged_at=None))
    else:
        notify(category, **message)
    return True


def apply_stage(standard, record, code):
    # Collection and manual records share stage-history recomputation.
    existing = db.query_one('SELECT id FROM standard_stage_history WHERE standard_id = %s AND stage_code = %s',
                            (standard['id'], code))
    data = dict(stage_code=code, effective_date=record['published_date'], is_manual=1,
                record_type='ADVANCE', note='中汽中心网站公告自动更新', reference=record['source_url'],
                updated_at=now(), updated_by=BOT)
    if existing:
        db.update('standard_stage_history', existing['id'], data)
    else:
        db.insert('standard_stage_history', dict(data, standard_id=standard['id'], created_at=now(), created_by=BOT))
    update = dict(updated_at=now(), updated_by=BOT)
    if code == 'PROJECT_APPROVAL' and not standard['plan_no']:
        update['plan_no'] = record['number']
    if code == 'RELEASED':
        update['actual_release_date'] = record['published_date']
        update['effective_date'] = record['effective_date']
        # Plan number stays separate when the formal standard number is announced.
        update['std_no'] = record['number']
    db.update('standard', standard['id'], update)
    stages.recompute(standard['id'])
    return True


def decide(candidate_id, decision):
    if decision not in ('confirmed', 'ignored'):
        raise ApiError('请选择确认或本次忽略')
    candidate = db.query_one('SELECT * FROM tracking_candidate WHERE id = %s', (candidate_id,))
    if not candidate:
        raise ApiError('待确认消息不存在', 404)
    if candidate['decision'] != 'pending':
        raise ApiError('该事项已由其他同事处理，请刷新', 409)
    changed = db.execute('UPDATE tracking_candidate SET decision = %s, decided_at = %s, decided_by = %s '
                         'WHERE id = %s AND decision = %s',
                         (decision, now(), current_user(), candidate_id, 'pending')).rowcount
    if changed != 1:
        db.rollback()
        raise ApiError('该事项已由其他同事处理，请刷新', 409)
    standard_id = None
    try:
        if decision == 'confirmed':
            record = json.loads(candidate['payload'])
            standard_id = confirm_project(record)
        db.execute('UPDATE notification SET is_read = 1, standard_id = %s, acknowledged_by = %s, acknowledged_at = %s WHERE candidate_id = %s',
                   (standard_id, current_user(), now(), candidate_id))
        db.commit()
    except Exception:
        db.rollback()
        raise
    return dict(decision=decision, standard_id=standard_id)


def confirm_project(record):
    existing = match_standard(record, include_archived=True)
    if existing:
        if existing['archived_at']:
            raise ApiError('已有同一标准的归档档案，请先在标准主档恢复后再确认追踪', 409)
        standard_id = existing['id']
        if existing['stage_code'] == 'PRE_RESEARCH':
            apply_stage(existing, record, 'PROJECT_APPROVAL')
        if not existing['plan_no']:
            db.update('standard', standard_id, dict(plan_no=record['number']))
    else:
        number = record['number']
        std_type = 'GB' if '-Q-' in number else 'GB/T' if '-T-' in number else '其他'
        standard_id = db.insert('standard', dict(plan_no=number, name_cn=record['name_cn'],
            stage_code='PROJECT_APPROVAL', std_type=std_type, tc_wg=record.get('tc_wg'),
            leading_org=(record.get('leading_org') or '').split('、')[0] or None, risk_level='TBD',
            scope=f'计划下达日期：{record["published_date"]}\n立项通知：{record["source_url"]}\n标准详情：{record.get("detail_url") or ""}\n起草单位：{record.get("leading_org") or ""}',
            created_at=now(), created_by=current_user(), updated_at=now(), updated_by=current_user()))
        stages._insert(standard_id, dict(stage_code='PROJECT_APPROVAL', effective_date=record['published_date'],
            note='确认追踪后按立项状态建档；网站立项日期：' + record['published_date'],
            reference=record['source_url']), 'ADVANCE')
    return standard_id


def execute_run(token, portal=None, at=None, session_id=None):
    """Network outside transactions; commit each standard together with its message."""
    at = at or china_now()
    config = db.query_one('SELECT * FROM crawler_settings WHERE id = 1')
    portal = portal or Portal(lambda: heartbeat(token))
    result = dict(discovered=0, updated=0, errors=[])
    try:
        heartbeat(token)
        window = history.begin_run(token, config, at, session_id)
        lookback_days = (at.date() - datetime.fromisoformat(window['window_start']).date()).days + 1
        for category in ('plans', 'comments', 'releases'):
            try:
                for notice in portal.notices(category, at.date(), lookback_days):
                    try:
                        heartbeat(token)
                        records = portal.records(notice, category)
                        heartbeat(token)
                        for record in records:
                            try:
                                added, updated = 0, 0
                                if category == 'plans':
                                    added, updated = discover(record)
                                else:
                                    updated = int(advance(record, category))
                                db.commit()
                                result['discovered'] += added
                                result['updated'] += updated
                            except Exception as error:
                                db.rollback()
                                result['errors'].append(f'{notice["url"]} {record["number"]}: {error}')
                    except LeaseLost:
                        raise
                    except Exception as error:
                        db.rollback()
                        result['errors'].append(f'{notice["url"]}: {error}')
            except LeaseLost:
                raise
            except Exception as error:
                db.rollback()
                result['errors'].append(f'{category}: {error}')
        heartbeat(token)
        config = db.query_one('SELECT * FROM crawler_settings WHERE id = 1')
        previous = json.loads(config['last_result']) if config['last_result'] else None
        if result['errors'] and (not previous or previous['errors'] != result['errors']):
            notify('error', '标准采集未全部完成', '\n'.join(result['errors']))
        due = config['next_run_at']
        finished = china_now()
        if config['enabled'] and (not due or due <= stamp(finished)):
            due = stamp(next_time(config, finished))
        history.finish_run(token, window, result, finished)
        db.execute('UPDATE crawler_settings SET lease_owner = NULL, lease_until = NULL, last_finished_at = %s, '
                   'last_result = %s, next_run_at = %s WHERE id = 1 AND lease_owner = %s',
                   (stamp(finished), json.dumps(result, ensure_ascii=False), due, token))
        db.commit()
    except Exception as error:
        db.rollback()
        history.fail_run(token, error, china_now(), interrupted=isinstance(error, LeaseLost))
        db.commit()
        raise
    finally:
        portal.close()
        db.execute('UPDATE crawler_settings SET lease_owner = NULL, lease_until = NULL WHERE id = 1 AND lease_owner = %s', (token,))
        db.commit()
    return result
