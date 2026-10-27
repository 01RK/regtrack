"""Native PostgreSQL access, bounded pool and request transactions."""
import atexit
import os
from functools import lru_cache
from flask import current_app, g
import psycopg
from psycopg.conninfo import conninfo_to_dict
from psycopg import sql, errors
from psycopg_pool import ConnectionPool
import paths
from constants import SCHEMA_VERSION
Error = psycopg.Error
IntegrityError = psycopg.IntegrityError
BUSY_ERRORS = (errors.LockNotAvailable, errors.DeadlockDetected, errors.SerializationFailure, errors.QueryCanceled)
class SchemaMismatch(RuntimeError): pass

def connect(dsn, autocommit=False):
    return psycopg.connect(dsn, autocommit=autocommit, client_encoding="utf8")

def make_pool(dsn):
    pool = ConnectionPool(dsn, min_size=2, max_size=int(os.getenv('REGTRACK_DB_POOL_MAX','16')),
        timeout=15, max_waiting=100, max_idle=300, open=True,
        check=ConnectionPool.check_connection,
        kwargs={'connect_timeout':10, 'client_encoding':'utf8', 'options':conninfo_to_dict(dsn).get('options','')+' -c statement_timeout=60000 -c lock_timeout=10000 -c idle_in_transaction_session_timeout=120000'})
    pool.wait(timeout=20)
    atexit.register(pool.close)
    return pool

def check_schema(dsn):
    with connect(dsn) as conn:
        version=conn.execute('SELECT schema_version FROM app_meta').fetchone()[0]
    if version != SCHEMA_VERSION:
        raise SchemaMismatch('Schema does not match this release. Initialize a new PostgreSQL database.')

def get_db():
    if 'db' not in g:
        g.db=current_app.extensions['regtrack_pool'].getconn()
    return g.db

def _run_hooks(name):
    for fn in g.pop(name, []):
        try: fn()
        except Exception: current_app.logger.exception('Object cleanup failed; run storage_audit.py')

def close_db(exc=None):
    conn=g.pop('db',None)
    if conn is not None:
        try: conn.rollback()
        except psycopg.Error: current_app.logger.warning('Discarding broken PostgreSQL connection')
        finally: current_app.extensions['regtrack_pool'].putconn(conn)
    _run_hooks('on_rollback')
    g.pop('on_commit',None)

def discard(): close_db()
def failure_kind(err, database=None):
    if isinstance(err,(psycopg.OperationalError,psycopg.InterfaceError)): return 'connection'
    return None

def execute(statement, params=()):
    return get_db().execute(statement, tuple(params))
def _rows(cursor):
    names=[c.name for c in cursor.description]
    return [dict(zip(names,row)) for row in cursor.fetchall()]
def query(statement, params=()): return _rows(execute(statement,params))
def query_one(statement, params=()):
    cursor=execute(statement,params)
    row=cursor.fetchone()
    return dict(zip((c.name for c in cursor.description),row)) if row is not None else None

def after_commit(fn): g.setdefault('on_commit',[]).append(fn)
def after_rollback(fn): g.setdefault('on_rollback',[]).append(fn)
def commit():
    get_db().commit()
    g.pop('on_rollback',None)
    _run_hooks('on_commit')
def rollback():
    if 'db' in g: g.db.rollback()
    g.pop('on_commit',None)
    _run_hooks('on_rollback')

def insert(table,data):
    cols=list(data)
    statement=sql.SQL('INSERT INTO {} ({}) VALUES ({}) RETURNING id').format(
        sql.Identifier(table),sql.SQL(',').join(map(sql.Identifier,cols)),sql.SQL(',').join(sql.Placeholder() for _ in cols))
    if table in {'standard_impact_area','meeting_standard'}:
        execute(statement.as_string().removesuffix(' RETURNING id'),[data[c] for c in cols])
        return None
    return execute(statement,[data[c] for c in cols]).fetchone()[0]
def update(table,row_id,data):
    if not data: return
    statement=sql.SQL('UPDATE {} SET {} WHERE id=%s').format(sql.Identifier(table),
        sql.SQL(',').join(sql.SQL('{}=%s').format(sql.Identifier(c)) for c in data))
    execute(statement,list(data.values())+[row_id])
def delete(table,row_id):
    execute(sql.SQL('DELETE FROM {} WHERE id=%s').format(sql.Identifier(table)),(row_id,))
@lru_cache(maxsize=128)
def _columns(dsn,table):
    with connect(dsn) as conn:
        return tuple(r[0] for r in conn.execute('SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=%s ORDER BY ordinal_position',(table,)))
def columns(table): return list(_columns(current_app.config['DATABASE'],table))
def marks(values): return ','.join('%s' for _ in values)
def contains(text):
    return '%' + text.replace(chr(92),chr(92)*2).replace('%',chr(92)+'%').replace('_',chr(92)+'_') + '%'
def coalesce(*expressions): return 'COALESCE(' + ','.join(expressions) + ')'
def next_serial(table,column,prefix,year):
    key=f'{table}:{column}:{prefix}:{year}'
    execute('SELECT pg_advisory_xact_lock(hashtext(%s))',(key,))
    statement=sql.SQL("SELECT COALESCE(MAX(substring({} from '[0-9]+$')::integer),0) FROM {} WHERE {} LIKE %s").format(sql.Identifier(column),sql.Identifier(table),sql.Identifier(column))
    base=execute(statement,(f'{prefix}-{year}-%',)).fetchone()[0]
    value=execute('INSERT INTO serial_counter(key,value) VALUES(%s,%s) '
                  'ON CONFLICT(key) DO UPDATE SET value=GREATEST(serial_counter.value,EXCLUDED.value-1)+1 '
                  'RETURNING value',(key,base+1)).fetchone()[0]
    return f'{prefix}-{year}-{value:03d}'

def init_db(dsn, with_seed=True):
    with connect(dsn) as conn:
        if conn.execute("SHOW server_encoding").fetchone()[0] != "UTF8":
            raise SchemaMismatch("Initialize a PostgreSQL database created with ENCODING UTF8.")
        conn.execute((paths.RESOURCE_DIR/'sql/schema.sql').read_text(encoding='utf-8'))
        conn.execute('INSERT INTO app_meta(schema_version) VALUES(%s)',(SCHEMA_VERSION,))
        if with_seed:
            conn.execute((paths.RESOURCE_DIR/'sql/seed.sql').read_text(encoding='utf-8'))
        for table, in conn.execute("SELECT table_name FROM information_schema.columns WHERE table_schema=current_schema() AND is_identity='YES'"):
            conn.execute(sql.SQL("SELECT setval(pg_get_serial_sequence(%s,'id'), COALESCE(MAX(id),0)+1, false) FROM {}").format(sql.Identifier(table)),(table,))
