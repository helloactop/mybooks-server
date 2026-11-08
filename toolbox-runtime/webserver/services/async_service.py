# -*- coding: utf-8 -*-
"""AsyncService 兼容层。

语义对齐 PoxenStudio：
- @register_function：同步函数包装，仍然在调用线程执行（插件外层通常用
  Tornado 的 run_in_executor 包住搜索/健康检查）；
- @register_service：把调用放入该服务名的单 worker 队列后立即返回 None。
  第一版每个服务一个常驻线程，插件下载任务串行。

限制：不做多进程、不做崩溃后续跑；任务重启恢复由 Node 侧把 running
标记为 failed，插件自身的搜索缓存/取消事件为进程内状态。
"""
import logging
import os
import queue
import threading


class SingletonType(type):
    _instances = {}

    def __call__(cls, *args, **kwargs):
        if cls not in cls._instances:
            cls._instances[cls] = super(SingletonType, cls).__call__(*args, **kwargs)
        return cls._instances[cls]


class AsyncService(metaclass=SingletonType):
    db = None
    session = None
    scoped_session = None
    heavy_lock_exempt = set()
    _running = {}
    _running_lock = threading.Lock()

    def setup(self, calibre_db=None, scoped_session=None, need_check_db=False):
        # 兼容 Poxen 的 register_function/register_service 调用点。
        self.db = calibre_db
        self.scoped_session = scoped_session
        self.session = scoped_session() if callable(scoped_session) else None
        return False

    def async_mode(self):
        return os.environ.get("TOOLBOX_ASYNC", "1") != "0"

    def _service_key(self, service_func):
        return "%s.%s" % (service_func.__module__, service_func.__qualname__)

    def start_service(self, service_func):
        name = self._service_key(service_func)
        with self._running_lock:
            if name in self._running:
                return self._running[name][1]
            jobs = queue.Queue()
            thread = threading.Thread(
                target=self._loop,
                args=(service_func, jobs),
                name="toolbox-service-" + service_func.__name__,
                daemon=True,
            )
            self._running[name] = (thread, jobs)
            thread.start()
            logging.info("[AsyncService] started worker %s", name)
            return jobs

    def _loop(self, service_func, jobs):
        while True:
            args, kwargs = jobs.get()
            try:
                service_func(self, *args, **kwargs)
            except Exception:
                logging.exception("[AsyncService] service failed: %s", self._service_key(service_func))
            finally:
                jobs.task_done()

    def add_msg(self, user_id, status, msg):
        # BaseTool 覆盖此方法；保留空实现供直接使用 AsyncService 的旧插件。
        logging.info("[AsyncService] message user=%s status=%s", user_id, status)

    @staticmethod
    def register_function(service_func):
        def func_wrapper(ins, *args, **kwargs):
            return service_func(ins, *args, **kwargs)

        func_wrapper.__name__ = service_func.__name__
        func_wrapper.__qualname__ = service_func.__qualname__
        func_wrapper.__module__ = service_func.__module__
        return func_wrapper

    @staticmethod
    def register_service(service_func=None, *, heavy=True):
        if service_func is None:
            return lambda func: AsyncService.register_service(func, heavy=heavy)

        name = "%s.%s" % (service_func.__module__, service_func.__qualname__)
        if not heavy:
            AsyncService.heavy_lock_exempt.add(name)

        def func_wrapper(ins, *args, **kwargs):
            service = AsyncService()
            if not service.async_mode():
                return service_func(ins, *args, **kwargs)
            jobs = ins.start_service(service_func)
            jobs.put((args, kwargs))
            logging.info("[AsyncService] queued %s", name)
            return None

        func_wrapper.__name__ = service_func.__name__
        func_wrapper.__qualname__ = service_func.__qualname__
        func_wrapper.__module__ = service_func.__module__
        return func_wrapper
