"""One scheduler in the central server; durable claims support crash recovery."""
import atexit
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.date import DateTrigger
from apscheduler.triggers.interval import IntervalTrigger
import tracking_service as service
import collection_history as history


class CollectionScheduler:
    def __init__(self, app):
        self.app = app
        self.session_id = None
        self.scheduler = BackgroundScheduler(timezone=service.CHINA)

    def start(self):
        with self.app.app_context():
            self.session_id = history.start_session(service.china_now())
        self.scheduler.add_job(self.tick, IntervalTrigger(seconds=30, timezone=service.CHINA), id='collection-clock',
                               max_instances=1, coalesce=True)
        self.scheduler.start()
        self.tick()
        atexit.register(self.stop)

    def stop(self):
        if self.scheduler.running:
            self.scheduler.shutdown(wait=True)
        if self.session_id is not None:
            with self.app.app_context():
                history.stop_session(self.session_id, service.china_now())
            self.session_id = None

    def tick(self):
        with self.app.app_context():
            token = service.claim()
            if token:
                self.scheduler.add_job(self.run, DateTrigger(timezone=service.CHINA), args=[token])

    def run(self, token):
        with self.app.app_context():
            try:
                service.execute_run(token, session_id=self.session_id)
            except Exception:
                self.app.logger.exception('标准采集失败')

    def manual(self):
        if not self.scheduler.running:
            from common import ApiError
            raise ApiError('采集调度器未启动，请使用 codes/run.py 启动程序', 503)
        token = service.claim(manual=True)
        if not token:
            from common import ApiError
            raise ApiError('已有采集任务正在运行', 409)
        self.scheduler.add_job(self.run, DateTrigger(timezone=service.CHINA), args=[token])
