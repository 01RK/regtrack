"""Draft images in MinIO; transaction hooks retain original semantics."""
import io
from flask import Response
from minio.error import S3Error
from common import ApiError
import db
import storage
EXTENSIONS={'image/png':'png','image/jpeg':'jpg','image/gif':'gif'}
URL_PREFIX='/files/'
def url(relative): return URL_PREFIX+relative
def save(folder,data,mime_type):
    key=storage.put(folder,io.BytesIO(data),len(data),mime_type)
    db.after_rollback(lambda:storage.remove(key))
    return key
def read(relative): return storage.read(relative)
def remove_after_commit(relatives):
    for key in relatives: db.after_commit(lambda key=key:storage.remove(key))
def send(relative):
    if not relative.startswith("drafts/"): raise ApiError("Image not found",404)
    try: info=storage.client().stat_object(storage.bucket(),relative)
    except S3Error as err:
        if err.code in ('NoSuchKey','NoSuchObject'): raise ApiError('File not found',404)
        raise
    mime=info.content_type if info.content_type in {'image/png','image/jpeg','image/gif'} else 'application/octet-stream'
    response=Response(storage.stream(relative),content_type=mime)
    if mime=='application/octet-stream': response.headers['Content-Disposition']='attachment'
    response.headers['Content-Length']=str(info.size)
    response.headers['X-Content-Type-Options']='nosniff'
    response.headers['Cache-Control']='private, max-age=86400'
    return response
