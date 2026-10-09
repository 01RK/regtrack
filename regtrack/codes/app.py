"""法规跟踪系统 — Flask 应用工厂。"""

import sqlite3
import traceback
from pathlib import Path

from flask import Flask, jsonify, render_template, request

import api
import db
import lifecycle
import paths
from common import ApiError
from db import init_db  # noqa: F401  （codes/init_db.py 与测试从这里取用）

BASE_DIR = paths.RESOURCE_DIR
DEFAULT_DB = paths.DEFAULT_DB

# 顶栏 5 个主入口（与设计文档 §0 的编号一致）
NAV = [
    {"key": "dashboard", "no": "", "url": "/", "label": "总览", "en": "Dashboard"},
    {"key": "standards", "no": "1", "url": "/standards", "label": "标准主档", "en": "Standard Profile"},
    {"key": "drafts", "no": "2", "url": "/drafts", "label": "草案登记", "en": "Draft Registry"},
    {"key": "meetings", "no": "3", "url": "/meetings", "label": "工作组会议", "en": "WG Meeting"},
    {"key": "comments", "no": "4", "url": "/comments", "label": "意见矩阵", "en": "Comment Matrix"},
    {"key": "actions", "no": "5", "url": "/actions", "label": "事项", "en": "Action Item"},
    {"key": "settings", "no": "", "url": "/settings", "label": "设置", "en": "Settings"},
]


def create_app(database: str | Path = DEFAULT_DB) -> Flask:
    database = Path(database)
    # 用户端首次点击 exe 时自动创建空库；生产启动绝不灌入 seed.sql。
    if not database.exists():
        init_db(database, with_seed=False)
    app = Flask(
        __name__,
        template_folder=str(BASE_DIR / "templates"),
        static_folder=str(BASE_DIR / "static"),
    )
    app.config["DATABASE"] = str(database)
    app.config["MAX_CONTENT_LENGTH"] = 20 * 1024 * 1024
    app.json.ensure_ascii = False
    app.teardown_appcontext(db.close_db)

    for blueprint in api.BLUEPRINTS:
        app.register_blueprint(blueprint)
    app.register_blueprint(lifecycle.bp)
    app.add_template_filter(lifecycle.md_block, "md_block")
    app.add_template_filter(lifecycle.md_inline, "md_inline")

    for item in NAV:
        _register_page(app, item)

    @app.get("/drafts/import")
    def draft_import_page():
        return render_template("draft_import.html", nav=NAV, active="drafts")

    @app.get("/meetings/import")
    def meeting_import_page():
        return render_template("meeting_import.html", nav=NAV, active="meetings")

    @app.get("/drafts/<int:draft_id>")
    def draft_detail_page(draft_id):
        return render_template("draft_detail.html", nav=NAV, active="drafts", draft_id=draft_id)

    _register_error_handlers(app)
    return app


def _register_error_handlers(app: Flask) -> None:
    """任何失败都回一条能定位问题的 JSON，前端不会再只看到「网络错误」。"""

    @app.errorhandler(ApiError)
    def _api_error(err: ApiError):
        return jsonify(err.payload()), err.status

    @app.errorhandler(413)
    def _too_large(err):
        return jsonify(error="文件过大，请选择 20 MB 以内的文件"), 413

    @app.errorhandler(sqlite3.IntegrityError)
    def _integrity_error(err: sqlite3.IntegrityError):
        db.rollback()
        raw = str(err)
        if "UNIQUE" in raw:
            column = raw.split(":")[-1].strip()
            message = f"违反唯一性约束：{column} 已存在"
        elif "CHECK" in raw:
            message = "字段取值不满足数据库约束，请检查固定值字段"
        elif "NOT NULL" in raw:
            message = f"必填字段为空：{raw.split(':')[-1].strip()}"
        elif "FOREIGN KEY" in raw:
            message = "关联记录不存在或已被删除"
        else:
            message = "数据库约束校验未通过"
        return jsonify(error=message, field=None, detail=raw), 400

    @app.errorhandler(sqlite3.Error)
    def _db_error(err: sqlite3.Error):
        db.rollback()
        return jsonify(error=f"数据库操作失败：{err}", field=None,
                       detail=type(err).__name__), 500

    @app.errorhandler(404)
    def _not_found(err):
        return jsonify(error="接口或页面不存在", field=None,
                       detail=request.path), 404

    @app.errorhandler(Exception)
    def _unexpected(err: Exception):
        # 兜底：宁可把异常原文交给用户，也不让浏览器只显示一句 fail to fetch
        db.rollback()
        app.logger.error("未处理的异常 %s: %s\n%s", request.path, err,
                         traceback.format_exc())
        return jsonify(error=f"服务器内部错误：{err}", field=None,
                       detail=type(err).__name__), 500


def _register_page(app: Flask, item: dict) -> None:
    key = item["key"]

    def view(_key=key):
        return render_template(f"{_key}.html", nav=NAV, active=_key)

    app.add_url_rule(item["url"], endpoint=f"page_{key}", view_func=view)
