"""Read-only audit: list missing referenced objects and unreferenced objects."""
from app import create_app
import db
import storage

def main():
    app=create_app()
    with app.app_context():
        refs={r['object_key'] for r in db.query('SELECT object_key FROM managed_file')}
        refs.update(r['file_path'] for r in db.query('SELECT file_path FROM draft_chapter_image'))
        actual={o.object_name for o in storage.client().list_objects(storage.bucket(),recursive=True)}
        for key in sorted(refs-actual): print('MISSING',key)
        for key in sorted(actual-refs): print('UNREFERENCED',key)
    app.extensions['regtrack_pool'].close()
if __name__=='__main__': main()
