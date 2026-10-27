"""法规跟踪系统 — Flask 应用工厂。"""

import traceback

from flask import Flask, jsonify, render_template, request

import api
import db
import files
import i18n
import lifecycle
from collection_scheduler import CollectionScheduler
import paths
from common import ApiError
from constants import APP_VERSION
from db import init_db  # noqa: F401  （codes/init_db.py 与测试从这里取用）

BASE_DIR = paths.RESOURCE_DIR
# 顶栏 5 个主入口（与设计文档 §0 的编号一致）
NAV = [
    {"key": "dashboard", "no": "", "url": "/", "label": "总览", "en": "Dashboard"},
    {"key": "standards", "no": "1", "url": "/standards", "label": "标准主档", "en": "Standard Profile"},
    {"key": "drafts", "no": "2", "url": "/drafts", "label": "草案登记", "en": "Draft Registry"},
    {"key": "meetings", "no": "3", "url": "/meetings", "label": "工作组会议", "en": "WG Meeting"},
    {"key": "comments", "no": "4", "url": "/comments", "label": "意见矩阵", "en": "Comment Matrix"},
    {"key": "actions", "no": "5", "url": "/actions", "label": "事项", "en": "Action Item"},
    {"key": "file_manager", "no": "6", "url": "/file-manager", "label": "文件管理", "en": "File Manager"},
    {"key": "settings", "no": "", "url": "/settings", "label": "设置", "en": "Settings"},
]


def create_app(database=None) -> Flask:
    import os
    import storage
    database = database or os.environ['REGTRACK_DATABASE_URL']
    db.check_schema(database)
    app = Flask(
        __name__,
        template_folder=str(BASE_DIR / "templates"),
        static_folder=str(BASE_DIR / "static"),
    )
    app.config["DATABASE"] = str(database)
    app.config["MAX_CONTENT_LENGTH"] = int(os.getenv("REGTRACK_MAX_UPLOAD_MB", "100")) * 1024 * 1024
    # 静态资源 URL 带版本号（?v=APP_VERSION），可放心让浏览器缓存，切换页面时不再逐个重新请求。
    app.config["SEND_FILE_MAX_AGE_DEFAULT"] = 7 * 24 * 3600
    app.extensions["regtrack_pool"] = db.make_pool(database)
    app.jinja_env.globals.update(app_version=APP_VERSION, database_path="PostgreSQL",
                                 files_path="MinIO")
    storage.configure(app)
    app.json.ensure_ascii = False
    app.teardown_appcontext(db.close_db)
    i18n.register(app)

    for blueprint in api.BLUEPRINTS:
        app.register_blueprint(blueprint)
    app.register_blueprint(lifecycle.bp)
    app.add_template_filter(lifecycle.md_block, "md_block")
    app.add_template_filter(lifecycle.md_inline, "md_inline")

    for item in NAV:
        _register_page(app, item)

    # 草案附图经服务端从对象存储读取。
    app.add_url_rule(files.URL_PREFIX + "<path:relative>", endpoint="attachment", view_func=files.send)

    @app.get("/drafts/import")
    def draft_import_page():
        return render_template("draft_import.html", nav=NAV, active="drafts")

    @app.get("/comments/import")
    def comment_import_page():
        return render_template("comment_import.html", nav=NAV, active="comments")

    @app.get("/comments/export")
    def comment_export_page():
        return render_template("comment_export.html", nav=NAV, active="comments")

    @app.get("/meetings/import")
    def meeting_import_page():
        return render_template("meeting_import.html", nav=NAV, active="meetings")

    @app.get("/drafts/comparisons/<int:comparison_id>")
    def comparison_page(comparison_id):
        return render_template("comparison_detail.html", nav=NAV, active="drafts", comparison_id=comparison_id)

    @app.get("/drafts/<int:draft_id>")
    def draft_detail_page(draft_id):
        return render_template("draft_detail.html", nav=NAV, active="drafts", draft_id=draft_id)

    app.add_url_rule("/notifications", endpoint="page_notifications",
                     view_func=lambda: render_template("notifications.html", nav=NAV, active="notifications"))
    app.add_url_rule("/notifications/standards", endpoint="page_standard_notifications",
                     view_func=lambda: render_template("standard_notifications.html", nav=NAV, active="notifications"))
    @app.get("/healthz")
    def health():
        db.query_one("SELECT 1 AS ready")
        if not storage.client().bucket_exists(storage.bucket()):
            return jsonify(status="unavailable"), 503
        return jsonify(status="ok", version=APP_VERSION)

    app.extensions["collection_scheduler"] = CollectionScheduler(app)
    _register_error_handlers(app)
    return app


def _register_error_handlers(app: Flask) -> None:
    """任何失败都回一条能定位问题的 JSON，前端不会再只看到「网络错误」。"""

    from psycopg_pool import PoolTimeout, TooManyRequests
    @app.errorhandler(PoolTimeout)
    @app.errorhandler(TooManyRequests)
    def _pool_busy(err):
        return jsonify(error="Database is busy. Please retry shortly."),503

    from minio.error import S3Error
    from urllib3.exceptions import HTTPError
    @app.errorhandler(S3Error)
    @app.errorhandler(HTTPError)
    def _storage_error(err):
        db.rollback()
        if isinstance(err,S3Error) and err.code in ('NoSuchKey','NoSuchObject'):
            return jsonify(error='文件不存在，可能已被删除'),404
        app.logger.exception('MinIO operation failed')
        return jsonify(error='MinIO storage unavailable. Check endpoint, bucket and permissions.'), 503

    @app.errorhandler(ApiError)
    def _api_error(err: ApiError):
        return jsonify(err.payload()), err.status

    @app.errorhandler(413)
    def _too_large(err):
        return jsonify(error=f'文件过大，请选择 {app.config["MAX_CONTENT_LENGTH"] // (1024 * 1024)} MB 以内的文件'), 413

    @app.errorhandler(db.Error)
    def _db_error(err: db.Error):
        raw = err.args[1] if len(err.args) > 1 else str(err)
        kind = db.failure_kind(err, app.config["DATABASE"])
        if kind and not isinstance(err,db.BUSY_ERRORS):
            # 连接可能已随网络断开：直接丢弃，不在失效的连接上回滚。
            db.discard()
            return jsonify(error=_connection_message(kind, request.method != "GET"),
                           field=None), 503
        db.rollback()
        if isinstance(err, db.BUSY_ERRORS):
            message, status = "数据正被其他操作占用，请稍后重试", 503
        elif isinstance(err, db.errors.UniqueViolation):
            message, status = "违反唯一性约束：相同编号或名称的记录已存在，请检查后重试", 400
        elif isinstance(err, db.errors.ForeignKeyViolation):
            message, status = "关联记录不存在或已被删除", 400
        elif isinstance(err, db.errors.NotNullViolation):
            message, status = "必填字段为空", 400
        elif isinstance(err, db.errors.StringDataRightTruncation):
            message, status = "填写内容超过数据库字段长度，请精简后重试", 400
        elif isinstance(err, db.IntegrityError):
            message, status = "数据库约束校验未通过", 400
        else:
            app.logger.exception("PostgreSQL operation failed")
            message, status = "数据库操作失败，请联系管理员查看服务器日志", 500
        return jsonify(error=message, field=None), status

    @app.errorhandler(404)
    def _not_found(err):
        return jsonify(error="接口或页面不存在", field=None,
                       detail=request.path), 404

    @app.errorhandler(Exception)
    def _unexpected(err: Exception):
        # 异常详情写入服务器日志。
        db.rollback()
        app.logger.error("未处理的异常 %s: %s\n%s", request.path, err,
                         traceback.format_exc())
        return jsonify(error="服务器内部错误，请联系管理员查看服务器日志", field=None), 500


def _connection_message(kind, writing):
    return 'PostgreSQL connection unavailable. Check the server and network; refresh before retrying a write.'


def _register_page(app: Flask, item: dict) -> None:
    key = item["key"]

    def view(_key=key):
        return render_template(f"{_key}.html", nav=NAV, active=_key)

    app.add_url_rule(item["url"], endpoint=f"page_{key}", view_func=view)
