"""Read-only live TLS/listing check; no database required."""
import json
import platform
import sys

from catarc_portal import BASE, SOURCES, Portal, parse_listing
from constants import APP_VERSION


def main():
    result = {"version": APP_VERSION, "python": platform.python_version(),
              "tls": "system trust store; verification enabled", "sources": {}}
    portal = Portal()
    failed = False
    try:
        for category, path in SOURCES.items():
            url = BASE + path + "?pageNo=1&pageSize=20"
            try:
                notices, pages = parse_listing(portal.fetch(url), url)
                result["sources"][category] = {"ok": True, "notices": len(notices), "pages": pages}
            except Exception as error:
                failed = True
                result["sources"][category] = {"ok": False, "error_type": type(error).__name__,
                                                "error": str(error)}
    finally:
        portal.close()
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
