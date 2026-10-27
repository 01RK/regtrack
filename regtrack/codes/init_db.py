"""Explicit initialization of a NEW PostgreSQL database and private MinIO bucket."""
import argparse
import os
from pathlib import Path
from flask import Flask
import db
import storage
import paths

def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--empty',action='store_true',help='Create schema without demonstration data')
    args=parser.parse_args(argv)
    dsn=os.environ['REGTRACK_DATABASE_URL']
    app=Flask(__name__)
    storage.configure(app)
    with app.app_context():
        client=storage.client(); bucket=storage.bucket()
        if not client.bucket_exists(bucket): client.make_bucket(bucket)
        if any(client.list_objects(bucket,recursive=True)):
            parser.error('Initialization requires an empty dedicated bucket. No existing data will be deleted.')
        db.init_db(dsn,with_seed=not args.empty)
        if not args.empty:
            for source in (paths.RESOURCE_DIR/'sql/seed-files').rglob('*'):
                if source.is_file():
                    import mimetypes
                    key=source.relative_to(paths.RESOURCE_DIR/'sql/seed-files').as_posix()
                    client.fput_object(bucket,key,str(source),content_type=mimetypes.guess_type(source.name)[0] or 'application/octet-stream')
    print('PostgreSQL schema and MinIO bucket initialized.')
    return 0
if __name__=='__main__': raise SystemExit(main())
