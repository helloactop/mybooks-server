/* ============================================================
 * Legacy Toolbox 运行时适配器（只读健康状态）
 *
 * 只把现有 runtimeHealth() 的结果规范化给 Runtime Manager；
 * 不重启 Worker、不代理调用，安装/启停/调用仍走原 toolbox 链路。
 * ============================================================ */

function createLegacyRuntimeAdapter({ health } = {}) {
  if (typeof health !== 'function') {
    throw new TypeError('Legacy Runtime 适配器需要注入 health');
  }

  return {
    runtimeId: 'legacy-toolbox',
    kind: 'legacy-toolbox',
    metadata: { displayName: 'Legacy Toolbox Worker' },
    health: async () => {
      const result = await health();
      const info = result && result.info && typeof result.info === 'object' ? result.info : {};
      return {
        online: !!(result && result.online),
        status: result && Number.isSafeInteger(result.status) ? result.status : 0,
        error: result && typeof result.error === 'string' ? result.error : '',
        details: {
          workerStatus: typeof info.status === 'string' ? info.status.slice(0, 32) : '',
          loaded: Array.isArray(info.plugins) ? info.plugins.length : 0,
        },
      };
    },
  };
}

module.exports = { createLegacyRuntimeAdapter };
