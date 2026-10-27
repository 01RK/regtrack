"""Run one central application server; users connect with their browsers."""
import argparse
import logging
import os
import signal
from waitress import serve
from app import create_app
from constants import APP_VERSION

def main(argv=None):
    parser=argparse.ArgumentParser(description=APP_VERSION)
    parser.add_argument('--host',default='127.0.0.1')
    parser.add_argument('--port',type=int,default=5000)
    parser.add_argument('--threads',type=int,default=32)
    args=parser.parse_args(argv)
    if not 1<=args.port<=65535 or not 1<=args.threads<=128:
        parser.error('Invalid port or thread count')
    logging.basicConfig(level=logging.INFO,format='%(asctime)s %(levelname)s %(name)s %(message)s')
    required=['REGTRACK_DATABASE_URL','REGTRACK_MINIO_ENDPOINT','REGTRACK_MINIO_BUCKET','REGTRACK_MINIO_ACCESS_KEY','REGTRACK_MINIO_SECRET_KEY']
    missing=[key for key in required if not os.getenv(key)]
    if missing: parser.error('Missing configuration: '+', '.join(missing)+'. See docs/DEPLOYMENT_ZH.md.')
    def terminate(signum, frame):
        raise KeyboardInterrupt
    signal.signal(signal.SIGTERM,terminate)
    app=create_app()
    scheduler=app.extensions['collection_scheduler']
    try:
        with app.app_context():
            import storage
            if not storage.client().bucket_exists(storage.bucket()):
                raise RuntimeError('Storage bucket does not exist. Initialize services first.')
        scheduler.start()
        serve(app,host=args.host,port=args.port,threads=args.threads,channel_timeout=120,max_request_body_size=app.config['MAX_CONTENT_LENGTH'])
    except KeyboardInterrupt:
        pass
    finally:
        try:
            scheduler.stop()
        finally:
            app.extensions['regtrack_pool'].close()
    return 0
if __name__=='__main__': raise SystemExit(main())
