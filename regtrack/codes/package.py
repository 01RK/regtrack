"""Build a clean cloud server source archive. Never embed credentials."""
import argparse
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
from constants import APP_VERSION
ROOT=Path(__file__).resolve().parent.parent
PROJECT=ROOT.parent
EXCLUDED={'__pycache__','.pytest_cache','.venv','.git','node_modules','build','release','data'}
def source_archive(destination):
    destination=Path(destination).resolve()
    with ZipFile(destination,'w',ZIP_DEFLATED) as archive:
        for path in sorted(PROJECT.rglob('*')):
            if not path.is_file() or path.resolve()==destination: continue
            if any(p in EXCLUDED for p in path.relative_to(PROJECT).parts): continue
            if path.suffix in {'.pyc','.accdb','.laccdb','.exe','.log'} or path.name in {'.env','minio.license','server-env.ps1','regtrack.env'}: continue
            archive.write(path,Path('regtrack-cloud')/path.relative_to(PROJECT))
    return destination

def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source',type=Path,required=True)
    args=parser.parse_args(argv)
    print(source_archive(args.source))
    return 0

if __name__=='__main__': raise SystemExit(main())
