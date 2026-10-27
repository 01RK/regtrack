"""Read-only application resources; persisted data lives in PostgreSQL and S3."""
from pathlib import Path
RESOURCE_DIR = Path(__file__).resolve().parent.parent
APP_DIR = RESOURCE_DIR
