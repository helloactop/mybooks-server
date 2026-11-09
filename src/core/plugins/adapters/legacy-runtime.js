/* ============================================================
 * Toolbox Python 运行时适配器（共享 Worker 或 supervisor 子进程）
 *
 * 只负责运行时动作：health / start / stop / invoke / reload / cancel；
 * 安装、启用、权限策略仍由 toolbox 仓库与旧 /api/toolbox/* 管理，
 * 不在这里另起一套插件生命周期。
 *
 * cancel 复用 Toolbox 任务取消（要求插件 manifest 声明 cancel 路由）；
 * 未注入实现时显式返回 RUNTIME_UNSUPPORTED，不允许伪装成“已取消”。
 * ============================================================ */

const RUNTIME_ID = 'legacy-toolbox';
const TOOL_ID_RE = /^[a-z0-9_]{1,64}$/;

function unsupported(method) {
  const err = new Error(`Toolbox 运行时暂不支持 ${method}`);
  err.code = 'RUNTIME_UNSUPPORTED';
  err.status = 501;
  return err;
}

function toolIdOf(instance) {
  const toolId = instance && typeof instance.toolId === 'string' ? instance.toolId : '';
  if (!TOOL_ID_RE.test(toolId)) {
    const err = new Error('插件实例缺少合法 toolId');
    err.code = 'TOOL_ID_INVALID';
    err.status = 400;
    throw err;
  }
  return toolId;
}

function createLegacyRuntimeAdapter({ health, start, stop, invoke, reload, cancel } = {}) {
  if (typeof health !== 'function') {
    throw new TypeError('Legacy Runtime 适配器需要注入 health');
  }

  const adapter = {
    runtimeId: RUNTIME_ID,
    kind: 'legacy-toolbox',
    metadata: { displayName: 'Toolbox Python Runtime' },
    health: async () => {
      const result = await health();
      const info = result && result.info && typeof result.info === 'object' ? result.info : {};
      const children = Array.isArray(info.children) ? info.children : [];
      return {
        online: !!(result && result.online),
        status: result && Number.isSafeInteger(result.status) ? result.status : 0,
        error: result && typeof result.error === 'string' ? result.error : '',
        details: {
          workerStatus: typeof info.status === 'string' ? info.status.slice(0, 32) : '',
          loaded: Array.isArray(info.plugins) ? info.plugins.length : 0,
          isolated: !!info.isolated,
          children: children.length,
          deferred: Array.isArray(info.deferred) ? info.deferred.length : 0,
        },
      };
    },
  };

  if (typeof reload === 'function') {
    adapter.reload = async () => reload();
  }
  if (typeof start === 'function') {
    adapter.start = async (instance) => start(toolIdOf(instance));
  }
  if (typeof stop === 'function') {
    adapter.stop = async (instance) => stop(toolIdOf(instance));
  }
  if (typeof invoke === 'function') {
    adapter.invoke = async (instance, request, context) => invoke(toolIdOf(instance), request || {}, context || {});
  }
  if (typeof cancel === 'function') {
    // operationId 是 Toolbox 任务 id；同时带上 toolId 防止跨插件取消。
    adapter.cancel = async (instance, operationId) => {
      const userId = instance && typeof instance.userId === 'string' ? instance.userId : '';
      return cancel(toolIdOf(instance), operationId, { userId });
    };
  } else {
    // 没有注入取消实现：保留显式失败，避免调用方误判成功。
    adapter.cancel = async () => { throw unsupported('cancel'); };
  }

  return adapter;
}

module.exports = { createLegacyRuntimeAdapter, RUNTIME_ID };
