import os
import sys
import uuid
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
import pytest

@pytest.fixture(scope='session')
def object_server():
    from moto.server import ThreadedMotoServer
    server=ThreadedMotoServer(ip_address='127.0.0.1',port=0,verbose=False)
    server.start()
    host,port=server.get_host_and_port()
    yield f'{host}:{port}'
    server.stop()

@pytest.fixture(autouse=True)
def resources(object_server,monkeypatch):
    import db
    import testdb
    from minio import Minio
    bucket='test-'+uuid.uuid4().hex
    for key,value in {'REGTRACK_MINIO_ENDPOINT':object_server,'REGTRACK_MINIO_BUCKET':bucket,
        'REGTRACK_MINIO_ACCESS_KEY':'testing','REGTRACK_MINIO_SECRET_KEY':'testing-secret','REGTRACK_MINIO_SECURE':'false'}.items(): monkeypatch.setenv(key,value)
    client=Minio(object_server,access_key='testing',secret_key='testing-secret',secure=False)
    client.make_bucket(bucket)
    pools=[];original=db.make_pool
    def make_pool(dsn):
        pool=original(dsn);pools.append(pool);return pool
    monkeypatch.setattr(db,'make_pool',make_pool)
    yield
    for pool in pools: pool.close()
    if testdb.DATABASES:
        import psycopg
        from psycopg import sql
        with psycopg.connect(os.environ['REGTRACK_TEST_ADMIN_DSN'],autocommit=True) as c:
            for name in testdb.DATABASES: c.execute(sql.SQL('DROP SCHEMA {} CASCADE').format(sql.Identifier(name)))
        testdb.DATABASES.clear()
