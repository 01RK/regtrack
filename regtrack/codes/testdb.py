"""Native disposable PostgreSQL databases for tests, never an emulator."""
import os
import uuid
from pathlib import Path
import pytest
import psycopg
from psycopg import sql
from psycopg.conninfo import conninfo_to_dict,make_conninfo
import db
DATABASES=[]

def new_database(initialize=False):
    admin=os.getenv('REGTRACK_TEST_ADMIN_DSN')
    if not admin: pytest.skip('Set REGTRACK_TEST_ADMIN_DSN to a dedicated PostgreSQL test server')
    name='regtrack_test_'+uuid.uuid4().hex
    with psycopg.connect(admin,autocommit=True) as c:
        c.execute(sql.SQL('CREATE SCHEMA {}').format(sql.Identifier(name)))
    DATABASES.append(name)
    params=conninfo_to_dict(admin);params['options']='-c search_path='+name+' -c client_encoding=UTF8'
    dsn=make_conninfo(**params)
    if initialize: globals()['initialize'](dsn,with_seed=False)
    return dsn

def initialize(dsn,with_seed=True):
    db.init_db(dsn,with_seed=with_seed)
    if with_seed:
        from minio import Minio
        import paths
        client=Minio(os.environ['REGTRACK_MINIO_ENDPOINT'],access_key='testing',secret_key='testing-secret',secure=False)
        for source in (paths.RESOURCE_DIR/'sql/seed-files').rglob('*'):
            if source.is_file(): client.fput_object(os.environ['REGTRACK_MINIO_BUCKET'],source.relative_to(paths.RESOURCE_DIR/'sql/seed-files').as_posix(),str(source))
