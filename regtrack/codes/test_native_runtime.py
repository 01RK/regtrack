"""Initialization and packaging contracts for the current stack."""
from pathlib import Path
import pytest
import db
import init_db
import package
import run
from testdb import new_database

def test_demo_initialization_uploads_seed_images(monkeypatch):
    dsn=new_database()
    monkeypatch.setenv('REGTRACK_DATABASE_URL',dsn)
    assert init_db.main([])==0
    db.check_schema(dsn)
    from app import create_app
    app=create_app(dsn)
    with app.app_context():
        import storage
        row=db.query_one('SELECT file_path FROM draft_chapter_image')
        assert storage.read(row['file_path']).startswith(b'\x89PNG')
    with pytest.raises(SystemExit): init_db.main([])

def test_empty_initialization(monkeypatch):
    dsn=new_database();monkeypatch.setenv('REGTRACK_DATABASE_URL',dsn)
    assert init_db.main(['--empty'])==0
    with db.connect(dsn) as c: assert c.execute('SELECT COUNT(*) FROM standard').fetchone()[0]==0

def test_source_package_excludes_secrets(tmp_path,monkeypatch):
    root=tmp_path/'source';root.mkdir()
    (root/'README.md').write_text('current stack')
    (root/'regtrack.env').write_text('SECRET')
    (root/'regtrack.env.example').write_text('CHANGE_ME')
    (root/'minio.license').write_text('LICENSE')
    monkeypatch.setattr(package,'PROJECT',root)
    destination=tmp_path/'source.zip';package.source_archive(destination)
    from zipfile import ZipFile
    with ZipFile(destination) as z:
        names=z.namelist()
        assert any(n.endswith('README.md') for n in names)
        assert any(n.endswith('regtrack.env.example') for n in names)
        assert not any(n.endswith('/regtrack.env') or n.endswith('/minio.license') for n in names)

def test_run_requires_explicit_configuration(monkeypatch):
    monkeypatch.delenv('REGTRACK_DATABASE_URL',raising=False)
    with pytest.raises(SystemExit) as error: run.main([])
    assert error.value.code==2
