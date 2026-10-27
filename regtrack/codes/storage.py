"""MinIO object access. No local-disk fallback."""
import os
import uuid
import ssl
import truststore
import urllib3
from flask import current_app
from minio import Minio

def configure(app):
    app.config['MINIO_BUCKET']=os.environ['REGTRACK_MINIO_BUCKET']
    app.extensions['minio']=Minio(os.environ['REGTRACK_MINIO_ENDPOINT'],
        access_key=os.environ['REGTRACK_MINIO_ACCESS_KEY'],secret_key=os.environ['REGTRACK_MINIO_SECRET_KEY'],
        secure=os.getenv('REGTRACK_MINIO_SECURE','true').lower()=='true',
        http_client=urllib3.PoolManager(timeout=urllib3.Timeout(connect=5,read=60),
            retries=urllib3.Retry(total=2,connect=1,read=0,status=1,status_forcelist=[500,502,503,504]),
            ssl_context=truststore.SSLContext(ssl.PROTOCOL_TLS_CLIENT)))
def client(): return current_app.extensions['minio']
def bucket(): return current_app.config['MINIO_BUCKET']
def put(prefix,stream,length,content_type):
    key=prefix.rstrip('/')+'/'+uuid.uuid4().hex
    client().put_object(bucket(),key,stream,length,content_type=content_type)
    return key
def read(key):
    response=client().get_object(bucket(),key)
    try: return response.read()
    finally:
        response.close()
        response.release_conn()
def remove(key): client().remove_object(bucket(),key)
def stream(key):
    object_client=client()
    object_bucket=bucket()
    response=object_client.get_object(object_bucket,key)
    def chunks():
        try: yield from response.stream(1024*1024)
        finally:
            response.close()
            response.release_conn()
    return chunks()
