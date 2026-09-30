"""五个主入口的 HTTP 接口，按 Form 分模块。"""

from api import actions, comments, drafts, lookups, meetings, meta, standards, transfer

BLUEPRINTS = [
    meta.bp, lookups.bp, standards.bp, drafts.bp,
    meetings.bp, comments.bp, actions.bp, transfer.bp,
]
