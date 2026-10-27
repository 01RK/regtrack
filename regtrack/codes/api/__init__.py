"""五个主入口的 HTTP 接口，按 Form 分模块。"""

from api import file_manager, comparisons, actions, comment_exchange, comments, drafts, lookups, meetings, meeting_imports, meta, standards, transfer, tracking

BLUEPRINTS = [file_manager.bp,
    comparisons.bp, meta.bp, lookups.bp, standards.bp, drafts.bp,
    meetings.bp, meeting_imports.bp, comments.bp, comment_exchange.bp, actions.bp, transfer.bp, tracking.bp,
]
