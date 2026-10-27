"""Check the configured PostgreSQL and MinIO with a temporary object round trip."""
import io
from app import create_app
import db
import storage

def main():
    app=create_app()
    try:
        with app.app_context():
            print('PostgreSQL:',db.query_one('SELECT version() AS version')['version'])
            body=b'RegTrack storage connectivity check'
            key=storage.put('healthcheck',io.BytesIO(body),len(body),'application/octet-stream')
            try:
                if storage.read(key)!=body: raise RuntimeError('Object readback differs from upload')
                print('MinIO: upload/read/download bytes verified')
            finally: storage.remove(key)
            print('Temporary object removed; services ready')
    finally: app.extensions['regtrack_pool'].close()
if __name__=='__main__': main()
