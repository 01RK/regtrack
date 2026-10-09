"""五个主入口的 HTTP 接口，按 Form 分模块。"""

from api import actions, comments, drafts, lookups, meetings, meeting_imports, meta, standards, transfer

BLUEPRINTS = [
    meta.bp, lookups.bp, standards.bp, drafts.bp,
    meetings.bp, meeting_imports.bp, comments.bp, actions.bp, transfer.bp,
]
