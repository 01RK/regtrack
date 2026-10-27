"""Scoped file explorer. PostgreSQL owns metadata; MinIO owns bytes."""
import re
from urllib.parse import quote
from flask import Blueprint, Response, jsonify, request
from common import ApiError, current_user, now
from constants import STAGES
import db
import storage
bp=Blueprint('file_manager',__name__,url_prefix='/api/file-manager')
STAGE_CODES={s['code'] for s in STAGES}|{'OTHER'}

def component(value):
    if not isinstance(value,str): raise ApiError('Invalid name',400)
    value=value.strip()
    if not value or value in ('.','..') or re.search(r'[\\/:*?"<>|\x00-\x1f]', value) or len(value)>255 or value.endswith('.'):
        raise ApiError('Invalid file or folder name',400)
    return value

def folder_path(value):
    if not isinstance(value,str): raise ApiError('Invalid folder path',400)
    if len(value)>1500: raise ApiError('Folder path is too long',400)
    if value:
        for part in value.split('/'): component(part)
    return value

def scope(source, lock=False):
    kind=source.get('scope')
    try: owner=int(source.get('owner_id',''))
    except (ValueError,TypeError): raise ApiError('Select a standard or workgroup',400)
    if kind=='standard':
        column='standard_id'
        exists=db.query_one('SELECT id FROM standard WHERE id=%s',(owner,))
    elif kind=='workgroup':
        column='workgroup_id'
        exists=db.query_one("SELECT id FROM lookup_value WHERE id=%s AND category='tc_wg'",(owner,))
    else: raise ApiError('Invalid storage scope',400)
    if lock:
        table='standard' if kind=='standard' else 'lookup_value'
        exists=db.query_one(f'SELECT id FROM {table} WHERE id=%s FOR UPDATE',(owner,))
    if not exists: raise ApiError('Standard or workgroup not found',404)
    stage=source.get('stage','OTHER')
    if not isinstance(stage,str) or stage not in STAGE_CODES or (kind=='workgroup' and stage!='OTHER'):
        raise ApiError('Invalid storage stage',400)
    return column,owner,stage

def location(source, lock=False):
    column,owner,stage=scope(source, lock=lock)
    folder=folder_path(source.get('folder',''))
    if folder and not db.query_one(f'SELECT id FROM managed_folder WHERE {column}=%s AND stage_code=%s AND path=%s',(owner,stage,folder)):
        raise ApiError('Folder not found',404)
    return column,owner,stage,folder

@bp.get('/scopes')
def scopes():
    return jsonify(standards=db.query("SELECT id,COALESCE(NULLIF(std_no,''),plan_no,'') AS number,name_cn FROM standard ORDER BY id DESC"),
        workgroups=db.query("SELECT id,value AS name FROM lookup_value WHERE category='tc_wg' ORDER BY sort_order,id"),
        stages=[dict(code=s['code'],name=s['cn'],en=s['en']) for s in STAGES]+[dict(code='OTHER',name='其他',en='Other')])

@bp.get('')
def listing():
    column,owner,stage,folder=location(request.args)
    try: page=max(1,int(request.args.get('page',1)))
    except ValueError: raise ApiError('Invalid page',400)
    where=f'{column}=%s AND stage_code=%s AND folder=%s'
    params=(owner,stage,folder)
    total=db.query_one(f'SELECT COUNT(*) AS n FROM managed_file WHERE {where}',params)['n']
    items=db.query(f'SELECT id,name,size_bytes,uploaded_by,uploaded_at FROM managed_file WHERE {where} ORDER BY name,id LIMIT 100 OFFSET %s',params+((page-1)*100,))
    folders=db.query(f'SELECT id,name,path FROM managed_folder WHERE {column}=%s AND stage_code=%s AND parent=%s ORDER BY name',params)
    return jsonify(items=items,folders=folders,total=total,page=page,page_size=100)

@bp.post('/folders')
def create_folder():
    data=request.get_json() or {}
    if not isinstance(data,dict): raise ApiError('Expected an object',400)
    column,owner,stage,parent=location(data, lock=True)
    name=component(data.get('name'))
    path=parent+'/'+name if parent else name
    if len(path)>1500: raise ApiError('Folder path is too long',400)
    if db.query_one(f'SELECT id FROM managed_folder WHERE {column}=%s AND stage_code=%s AND path=%s',(owner,stage,path)):
        raise ApiError('Folder already exists',409)
    row_id=db.insert('managed_folder',{column:owner,'stage_code':stage,'parent':parent,'name':name,'path':path})
    db.commit()
    return jsonify(id=row_id,path=path),201

@bp.post('/upload')
def upload():
    column,owner,stage,folder=location(request.form, lock=True)
    upload=request.files.get('file')
    if upload is None: raise ApiError('Select a file',400)
    name=component(upload.filename)
    upload.stream.seek(0,2); length=upload.stream.tell(); upload.stream.seek(0)
    existing=db.query_one(f'SELECT id,object_key FROM managed_file WHERE {column}=%s AND stage_code=%s AND folder=%s AND name=%s',(owner,stage,folder,name))
    if existing and request.form.get('overwrite')!='1':
        raise ApiError('文件夹中已有同名文件，是否覆盖？',409)
    key=storage.put(f'managed/{column}/{owner}/{stage}',upload.stream,length,
                    upload.mimetype or 'application/octet-stream')
    db.after_rollback(lambda:storage.remove(key))
    metadata={column:owner,'stage_code':stage,'folder':folder,'name':name,
        'object_key':key,'size_bytes':length,'content_type':upload.mimetype or 'application/octet-stream',
        'uploaded_by':current_user(),'uploaded_at':now()}
    if existing:
        row_id=existing['id']
        db.update('managed_file',row_id,metadata)
        db.after_commit(lambda:storage.remove(existing['object_key']))
    else:
        row_id=db.insert('managed_file',metadata)
    db.commit()
    return jsonify(id=row_id),201

@bp.get('/<int:file_id>/download')
def download(file_id):
    row=db.query_one('SELECT * FROM managed_file WHERE id=%s',(file_id,))
    if not row: raise ApiError('File not found',404)
    storage.client().stat_object(storage.bucket(),row['object_key'])
    # Release the DB connection before a potentially slow download.
    db.rollback()
    response=Response(storage.stream(row['object_key']),content_type='application/octet-stream')
    response.headers['Content-Disposition']="attachment; filename*=UTF-8''"+quote(row['name'],safe='')
    response.headers['Content-Length']=str(row['size_bytes'])
    response.headers['X-Content-Type-Options']='nosniff'
    return response

def row_source(row):
    return dict(scope='standard' if row['standard_id'] is not None else 'workgroup',
                owner_id=row['standard_id'] if row['standard_id'] is not None else row['workgroup_id'],
                stage=row['stage_code'])


@bp.delete('/<int:file_id>')
def delete(file_id):
    row=db.query_one('SELECT * FROM managed_file WHERE id=%s',(file_id,))
    if not row: raise ApiError('File not found',404)
    scope(row_source(row),lock=True)
    row=db.query_one('SELECT object_key FROM managed_file WHERE id=%s',(file_id,))
    if not row: raise ApiError('File not found',404)
    db.delete('managed_file',file_id)
    db.after_commit(lambda:storage.remove(row['object_key']))
    db.commit()
    return jsonify(ok=True)


@bp.delete('/folders/<int:folder_id>')
def delete_folder(folder_id):
    row=db.query_one('SELECT * FROM managed_folder WHERE id=%s',(folder_id,))
    if not row: raise ApiError('Folder not found',404)
    column,owner,stage=scope(row_source(row),lock=True)
    row=db.query_one('SELECT path FROM managed_folder WHERE id=%s',(folder_id,))
    if not row: raise ApiError('Folder not found',404)
    path=row['path']
    params=(owner,stage,path,path+'/')
    where=f'{column}=%s AND stage_code=%s'
    keys=db.query(f'SELECT object_key FROM managed_file WHERE {where} AND (folder=%s OR starts_with(folder,%s))',params)
    db.execute(f'DELETE FROM managed_file WHERE {where} AND (folder=%s OR starts_with(folder,%s))',params)
    db.execute(f'DELETE FROM managed_folder WHERE {where} AND (path=%s OR starts_with(path,%s))',params)
    for item in keys:
        db.after_commit(lambda key=item['object_key']:storage.remove(key))
    db.commit()
    return jsonify(ok=True,files=len(keys))


def assert_workgroups_empty(lookup_ids):
    for owner in sorted(lookup_ids):
        db.execute('SELECT id FROM lookup_value WHERE id=%s FOR UPDATE',(owner,))
        count=db.query_one('SELECT COUNT(*) AS n FROM managed_file WHERE workgroup_id=%s',(owner,))['n']
        if count:
            raise ApiError(f'工作组文件夹中还有 {count} 个文件，请先删除文件或停用工作组。',409)
