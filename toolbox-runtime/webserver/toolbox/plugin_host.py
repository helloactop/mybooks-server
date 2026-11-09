# -*- coding: utf-8 -*-
"""插件加载与路由注册。

Node 通过共享卷 state/installed.json 告诉 runtime 哪些工具启用；
本模块按 manifest 动态 import backend，并把 api_routes 映射成
(tool_id, path) -> handler class。路由表可热替换，禁用立即生效。
"""
import importlib
import importlib.util
import json
import logging
import os
import re
import sys
import threading

from webserver.handlers.base import BaseHandler
from webserver.toolbox.base_tool import BaseTool
from . import config

TOOL_ID_RE = re.compile(r"^[a-z0-9_]{1,64}$")
ROUTE_RE = re.compile(r"^[A-Za-z0-9_.\-/]+$")


class PluginError(RuntimeError):
    pass


class PluginEntry(object):
    def __init__(self, tool_id, revision, manifest, tool_cls, routes):
        self.tool_id = tool_id
        self.revision = revision
        self.manifest = manifest
        self.tool_cls = tool_cls
        self.routes = routes

    def summary(self):
        return {
            "tool_id": self.tool_id,
            "revision": self.revision,
            "routes": sorted(self.routes.keys()),
            "frontend": self.manifest.get("entry_frontend") or "",
        }


class PluginHost(object):
    def __init__(self):
        self._registry = {}
        self._lock = threading.Lock()
        self._generation = 0

    def get(self, tool_id):
        return self._registry.get(tool_id)

    def route(self, tool_id, path):
        entry = self._registry.get(tool_id)
        if not entry:
            return None
        return entry.routes.get(path)

    def summary(self):
        return [entry.summary() for entry in self._registry.values()]

    def _read_state(self):
        try:
            with open(config.STATE_FILE, "r", encoding="utf-8") as handle:
                document = json.load(handle)
        except FileNotFoundError:
            return []
        except (OSError, ValueError) as err:
            logging.error("[plugin_host] state file invalid: %s", err)
            return []
        tools = document.get("tools") if isinstance(document, dict) else None
        if not isinstance(tools, list):
            return []
        only = os.environ.get("TOOLBOX_ONLY_TOOL", "").strip()
        if only:
            tools = [item for item in tools if isinstance(item, dict) and str(item.get("tool_id")) == only]
        return tools

    def _load(self, item, generation):
        tool_id = str(item.get("tool_id") or "")
        if not TOOL_ID_RE.match(tool_id):
            raise PluginError("tool_id 不合法")
        install_rel = str(item.get("install_path") or "")
        if not install_rel or install_rel.startswith("/") or ".." in install_rel.split("/"):
            raise PluginError("install_path 不合法")
        install_dir = os.path.realpath(os.path.join(config.TOOLBOX_ROOT, install_rel))
        plugins_root = os.path.realpath(config.PLUGINS_ROOT)
        if not install_dir.startswith(plugins_root + os.sep):
            raise PluginError("install_path 越出插件目录")

        manifest_path = os.path.join(install_dir, "manifest.json")
        with open(manifest_path, "r", encoding="utf-8") as handle:
            manifest = json.load(handle)
        if str(manifest.get("tool_id")) != tool_id:
            raise PluginError("manifest.tool_id 与安装记录不一致")
        entry_backend = str(manifest.get("entry_backend") or "")
        if "." not in entry_backend:
            raise PluginError("entry_backend 格式不合法")

        backend_dir = os.path.join(install_dir, "backend")
        needed_modules = set()
        module_rel, class_name = entry_backend.rsplit(".", 1)
        needed_modules.add(module_rel)
        routes = {}
        for route in manifest.get("api_routes") or []:
            path = str(route.get("path") or "").strip().lstrip("/").rstrip("/")
            handler = str(route.get("handler") or "")
            if not path or ".." in path or not ROUTE_RE.match(path) or "." not in handler:
                raise PluginError("api_routes 声明不合法")
            handler_module, handler_class = handler.rsplit(".", 1)
            needed_modules.add(handler_module)
            routes[path] = (handler_module, handler_class)

        modules = self._import_modules(tool_id, backend_dir, sorted(needed_modules), generation)
        tool_module = modules[module_rel]
        tool_cls = getattr(tool_module, class_name, None)
        if not isinstance(tool_cls, type) or not issubclass(tool_cls, BaseTool):
            raise PluginError("%s 不是 BaseTool 子类" % class_name)

        resolved_routes = {}
        for path, (handler_module, handler_class) in routes.items():
            handler_cls = getattr(modules[handler_module], handler_class, None)
            if not isinstance(handler_cls, type) or not issubclass(handler_cls, BaseHandler):
                raise PluginError("路由 %s 的 handler 不是 BaseHandler 子类" % path)
            resolved_routes[path] = handler_cls
        return PluginEntry(tool_id, str(manifest.get("revision") or ""), manifest, tool_cls, resolved_routes)

    def _import_modules(self, tool_id, backend_dir, module_rels, generation):
        if not os.path.isdir(backend_dir):
            raise PluginError("缺少 backend/ 目录")
        package_name = None
        init_file = os.path.join(backend_dir, "__init__.py")
        if os.path.exists(init_file):
            package_name = "mybooks_tool_%s_backend_g%d" % (tool_id, generation)
            spec = importlib.util.spec_from_file_location(
                package_name, init_file, submodule_search_locations=[backend_dir])
            if spec is None or spec.loader is None:
                raise PluginError("无法加载 backend/__init__.py")
            package = importlib.util.module_from_spec(spec)
            sys.modules[package_name] = package
            spec.loader.exec_module(package)

        modules = {}
        for module_rel in module_rels:
            module_file = os.path.join(backend_dir, *module_rel.split(".")) + ".py"
            if not os.path.exists(module_file):
                raise PluginError("缺少模块文件 %s" % module_file)
            if package_name:
                module_name = "%s.%s" % (package_name, module_rel)
            else:
                module_name = "mybooks_tool_%s_%s_g%d" % (tool_id, module_rel.replace(".", "_"), generation)
            spec = importlib.util.spec_from_file_location(module_name, module_file)
            if spec is None or spec.loader is None:
                raise PluginError("无法加载模块 %s" % module_file)
            module = importlib.util.module_from_spec(spec)
            if package_name:
                module.__package__ = package_name
            sys.modules[module_name] = module
            spec.loader.exec_module(module)
            modules[module_rel] = module
        return modules

    def reload(self):
        with self._lock:
            self._generation += 1
            generation = self._generation
            registry = {}
            reports = []
            for item in self._read_state():
                if not item.get("enabled"):
                    continue
                tool_id = str(item.get("tool_id") or "")
                try:
                    entry = self._load(item, generation)
                    registry[entry.tool_id] = entry
                    reports.append({"tool_id": entry.tool_id, "loaded": True,
                                    "revision": entry.revision, "error": ""})
                    logging.info("[plugin_host] loaded %s %s", entry.tool_id, entry.revision)
                except Exception as err:
                    logging.exception("[plugin_host] failed to load %s", tool_id)
                    reports.append({"tool_id": tool_id, "loaded": False,
                                    "revision": str(item.get("revision") or ""),
                                    "error": str(err)})
            self._registry = registry
            logging.info("[plugin_host] reload complete: %s", ", ".join(sorted(registry)) or "none")
            return reports


host = PluginHost()
