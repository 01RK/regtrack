"""Real PostgreSQL + official MinIO SDK against a local S3 protocol test server."""
import io
import json
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import pytest
import requests
from waitress import create_server
from app import create_app
from testdb import new_database,initialize
import db
import files
import storage

@pytest.fixture
def app():
    dsn=new_database();initialize(dsn,with_seed=True)
    return create_app(dsn)

def context(app):
    c=app.test_client()
    sid=c.get('/api/standards').json['items'][0]['id']
    return c,dict(scope='standard',owner_id=str(sid),stage='OTHER',folder='')

def upload(c,p,name='sample.txt',body=b'example'):
    return c.post('/api/file-manager/upload',data={**p,'file':(io.BytesIO(body),name)},headers={'X-User':'Tester'})

def test_upload_download_delete(app):
    c,p=context(app)
    r=upload(c,p,'report.txt',b'file bytes');assert r.status_code==201,r.json
    fid=r.json['id']
    r=c.get(f'/api/file-manager/{fid}/download');assert r.data==b'file bytes'
    assert 'attachment' in r.headers['Content-Disposition']
    assert c.get('/api/file-manager',query_string=p).json['total']==1
    assert c.delete(f'/api/file-manager/{fid}').status_code==200
    assert c.get(f'/api/file-manager/{fid}/download').status_code==404
    with app.app_context(): assert list(storage.client().list_objects(storage.bucket(),prefix='managed/',recursive=True))==[]

def test_folders_stage_and_workgroup_isolation(app):
    c,p=context(app)
    r=c.post('/api/file-manager/folders',json={**p,'name':'docs'});assert r.status_code==201,r.json
    p['folder']='docs'
    assert upload(c,p).status_code==201
    assert c.get('/api/file-manager',query_string=p).json['total']==1
    other={**p,'stage':'DRAFTING','folder':''}
    assert c.get('/api/file-manager',query_string=other).json['total']==0
    group=c.get('/api/file-manager/scopes').json['workgroups'][0]
    gp=dict(scope='workgroup',owner_id=str(group['id']),stage='OTHER',folder='')
    assert upload(c,gp).status_code==201
    assert c.get('/api/file-manager',query_string=gp).json['total']==1
    assert c.get('/api/file-manager',query_string={**gp,'stage':'DRAFTING'}).status_code==400

def test_duplicate_upload_rolls_back_object(app):
    c,p=context(app)
    assert upload(c,p).status_code==201
    assert upload(c,p).status_code==409
    with app.app_context():
        assert len(list(storage.client().list_objects(storage.bucket(),prefix='managed/',recursive=True)))==1
        assert db.query_one('SELECT COUNT(*) AS n FROM managed_file')['n']==1

def test_draft_image_rollback_and_commit(app):
    with app.app_context():
        key=files.save('drafts',b'image','image/png')
        assert files.read(key)==b'image'
        db.rollback()
        assert not list(storage.client().list_objects(storage.bucket(),prefix=key))
    with app.app_context():
        key=files.save('drafts',b'image','image/png');db.commit()
        assert files.read(key)==b'image'
        files.remove_after_commit([key]);db.rollback();assert files.read(key)==b'image'
        files.remove_after_commit([key]);db.commit()
        assert not list(storage.client().list_objects(storage.bucket(),prefix=key))

def test_trust_boundary_validation(app):
    c,p=context(app)
    for name in ['../escape','a/b','..']:
        assert c.post('/api/file-manager/folders',json={**p,'name':name}).status_code==400
    assert c.post('/api/file-manager/folders',json={**p,'name':123}).status_code==400
    assert c.get('/api/file-manager',query_string={**p,'folder':'../escape'}).status_code==400
    assert c.get('/api/file-manager',query_string={**p,'owner_id':'missing'}).status_code==400
    assert c.get('/api/file-manager',query_string={**p,'owner_id':'999999'}).status_code==404

def test_standard_deletion_cleans_managed_files(app):
    c,p=context(app);assert upload(c,p).status_code==201
    r=c.delete('/api/standards/'+p['owner_id'],headers={'X-User':'Tester'})
    assert r.status_code==200,r.json
    with app.app_context():
        assert db.query_one('SELECT COUNT(*) AS n FROM managed_file')['n']==0
        assert not list(storage.client().list_objects(storage.bucket(),prefix='managed/',recursive=True))

def test_atomic_serials_50_workers(app):
    def allocate(i):
        with app.app_context():
            number=db.next_serial('meeting','meeting_no','CONCURRENT','2099');db.commit();return number
    with ThreadPoolExecutor(max_workers=50) as pool: numbers=list(pool.map(allocate,range(100)))
    assert len(set(numbers))==100

def test_50_http_clients_mixed_read_write(app):
    server=create_server(app,host='127.0.0.1',port=55009,threads=32)
    thread=threading.Thread(target=server.run,daemon=True);thread.start()
    barrier=threading.Barrier(50)
    def client(i):
        barrier.wait(timeout=30)
        samples=[]
        with requests.Session() as session:
            session.trust_env=False
            for n in range(5):
                started=time.perf_counter()
                if n==0:
                    r=session.post('http://127.0.0.1:55009/api/standards',json={'name_cn':f'Concurrent {i}','stage_code':'DRAFTING'},headers={'X-User':f'Load-{i}'},timeout=60)
                    expected=201
                else:
                    r=session.get('http://127.0.0.1:55009/api/standards',params={'page_size':25},timeout=60);expected=200
                assert r.status_code==expected,(r.status_code,r.text)
                samples.append(time.perf_counter()-started)
        return samples
    try:
        with ThreadPoolExecutor(max_workers=50) as pool: samples=[v for group in pool.map(client,range(50)) for v in group]
        report={'clients':50,'requests':len(samples),'errors':0,'p95_seconds':sorted(samples)[int(len(samples)*.95)-1],'max_seconds':max(samples),'pool_max':app.extensions['regtrack_pool'].max_size}
        print('LOAD_RESULT',json.dumps(report))
    finally:
        server.close();thread.join(timeout=5)
