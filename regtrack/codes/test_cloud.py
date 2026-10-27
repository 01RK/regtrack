"""Cloud fusion behavior against real PostgreSQL and the S3 protocol."""
import io
import json
from concurrent.futures import ThreadPoolExecutor
import threading
import pytest
from app import create_app
from testdb import new_database, initialize
from test_native_storage import context, upload
import db
import storage

@pytest.fixture
def app():
    dsn=new_database();initialize(dsn,with_seed=True)
    return create_app(dsn)


def objects(app):
    with app.app_context():
        return [item.object_name for item in storage.client().list_objects(storage.bucket(),prefix='managed/',recursive=True)]


def test_overwrite_is_explicit_and_atomic(app,monkeypatch):
    c,p=context(app)
    original=upload(c,p,body=b'old').json['id']
    assert upload(c,p,body=b'new').status_code==409
    assert c.get(f'/api/file-manager/{original}/download').data==b'old'
    def replace(body):
        return c.post('/api/file-manager/upload',data={**p,'overwrite':'1','file':(io.BytesIO(body),'sample.txt')},headers={'X-User':'Tester'})
    with monkeypatch.context() as patch:
        patch.setattr(db,'update',lambda *args: (_ for _ in ()).throw(RuntimeError('write failed')))
        assert replace(b'failed').status_code==500
    assert c.get(f'/api/file-manager/{original}/download').data==b'old'
    assert len(objects(app))==1
    result=replace(b'new')
    assert result.status_code==201,result.json
    assert result.json['id']==original
    assert c.get(f'/api/file-manager/{original}/download').data==b'new'
    assert len(objects(app))==1


def test_recursive_folder_delete_preserves_siblings(app):
    c,p=context(app)
    folders={}
    for path in ['docs','docs/child','docs2']:
        parent,_,name=path.rpartition('/')
        r=c.post('/api/file-manager/folders',json={**p,'folder':parent,'name':name})
        assert r.status_code==201,r.json
        folders[path]=r.json['id']
        assert upload(c,{**p,'folder':path}).status_code==201
    assert c.delete(f"/api/file-manager/folders/{folders['docs']}").json['files']==2
    assert c.get('/api/file-manager',query_string={**p,'folder':'docs/child'}).status_code==404
    assert c.get('/api/file-manager',query_string={**p,'folder':'docs2'}).json['total']==1
    assert len(objects(app))==1
    assert c.delete(f"/api/file-manager/folders/{folders['docs']}").status_code==404


def test_workgroup_with_files_cannot_be_deleted_or_replaced(app):
    c,p=context(app)
    group=c.get('/api/file-manager/scopes').json['workgroups'][0]
    gp=dict(scope='workgroup',owner_id=str(group['id']),stage='OTHER',folder='')
    assert upload(c,gp).status_code==201
    assert c.delete(f"/api/lookups/{group['id']}").status_code==409
    bundle={'format':'regtrack-lookup','category':'tc_wg','items':[]}
    result=c.post('/api/transfer/lookup/tc_wg/import',data={'mode':'replace','file':(io.BytesIO(json.dumps(bundle).encode()),'lookup.json')})
    assert result.status_code==409,result.json
    assert c.put(f"/api/lookups/{group['id']}",json={'is_active':False}).status_code==200
    assert c.get('/api/file-manager',query_string=gp).json['total']==1


def test_serials_beyond_999_and_after_import(app):
    with app.app_context():
        db.insert('meeting',{'meeting_no':'BOUNDARY-2099-999','title':'boundary','meeting_date':'2099-01-01','created_by':'Tester','created_at':'2099-01-01 00:00:00','updated_at':'2099-01-01 00:00:00'})
        assert db.next_serial('meeting','meeting_no','BOUNDARY','2099')=='BOUNDARY-2099-1000'
        db.commit()
        db.insert('meeting',{'meeting_no':'BOUNDARY-2099-1500','title':'imported','meeting_date':'2099-01-01','created_by':'Tester','created_at':'2099-01-01 00:00:00','updated_at':'2099-01-01 00:00:00'})
        assert db.next_serial('meeting','meeting_no','BOUNDARY','2099')=='BOUNDARY-2099-1501'
        db.commit()


def test_folder_delete_racing_upload_leaves_no_orphans(app):
    c,p=context(app)
    folder=c.post('/api/file-manager/folders',json={**p,'name':'race'}).json['id']
    barrier=threading.Barrier(2)
    def add():
        barrier.wait()
        return upload(app.test_client(),{**p,'folder':'race'}).status_code
    def remove():
        barrier.wait()
        return app.test_client().delete(f'/api/file-manager/folders/{folder}').status_code
    with ThreadPoolExecutor(max_workers=2) as executor:
        added=executor.submit(add);removed=executor.submit(remove)
        assert added.result() in (201,404)
        assert removed.result()==200
    assert objects(app)==[]
    with app.app_context():
        assert db.query_one('SELECT COUNT(*) AS n FROM managed_file')['n']==0


def test_error_classification_and_upload_limit(app):
    from flask import abort
    @app.get('/test-lock')
    def locked():
        raise db.errors.LockNotAvailable('busy')
    @app.get('/test-limit')
    def limited():
        abort(413)
    c=app.test_client()
    assert c.get('/test-lock').status_code==503
    assert str(app.config['MAX_CONTENT_LENGTH']//(1024*1024)) in c.get('/test-limit').json['error']
    assert c.get('/healthz').json['status']=='ok'


def test_server_lifecycle_starts_and_stops_one_scheduler(app,monkeypatch):
    import run
    monkeypatch.setenv('REGTRACK_DATABASE_URL',app.config['DATABASE'])
    monkeypatch.setattr(run,'create_app',lambda:app)
    observed=[]
    def serve(application,**options):
        scheduler=application.extensions['collection_scheduler']
        assert scheduler.scheduler.running
        assert scheduler.session_id is not None
        assert options['host']=='127.0.0.1'
        observed.append(scheduler.session_id)
    with app.app_context():
        db.execute('UPDATE crawler_settings SET enabled=0 WHERE id=1')
        db.commit()
    monkeypatch.setattr(run,'serve',serve)
    assert run.main([])==0
    assert len(observed)==1
    assert not app.extensions['collection_scheduler'].scheduler.running
    with db.connect(app.config['DATABASE']) as conn:
        assert conn.execute('SELECT stopped_at FROM crawler_startup WHERE id=%s',(observed[0],)).fetchone()[0]


def test_missing_bucket_prevents_server_start_and_closes_pool(app,monkeypatch):
    import run
    monkeypatch.setenv('REGTRACK_DATABASE_URL',app.config['DATABASE'])
    monkeypatch.setattr(run,'create_app',lambda:app)
    monkeypatch.setattr(run,'serve',lambda *args,**kwargs: pytest.fail('must not serve'))
    app.config['MINIO_BUCKET']='missing-bucket'
    with pytest.raises(RuntimeError,match='bucket'):
        run.main([])
    assert app.extensions['regtrack_pool'].closed
    assert not app.extensions['collection_scheduler'].scheduler.running
