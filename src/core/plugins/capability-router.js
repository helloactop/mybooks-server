/* ============================================================
 * Capability Router：输入校验 → 权限 → Provider 选择 → 调用 → 输出校验
 *
 * 与 Registry 的分工：Registry 只回答“谁能提供能力”，Router 决定
 * “这次调用是否允许、调用谁、超时与错误如何归一”。
 * principal 为空表示可信宿主调用；插件调用必须传 principal 并先授权。
 * ============================================================ */

const { GrantStore } = require('./permissions');

const DEFAULT_TIMEOUT_MS = 45_000;

class CapabilityError extends Error {
  constructor(code, message, status = 400, cause) {
    super(message || code);
    this.name = 'CapabilityError';
    this.code = code;
    this.status = status;
    if (cause) this.cause = cause;
  }
}

function withTimeout(promise, ms, message) {
  if (!ms) return promise;
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new CapabilityError('UPSTREAM_TIMEOUT', message, 504)), ms);
    if (typeof timer.unref === 'function') timer.unref();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function mapProviderError(err) {
  if (err && typeof err.code === 'string' && Number.isSafeInteger(err.status)) return err;
  const code = err && err.code;
  if (code === 'BLOCKED') {
    return new CapabilityError('UPSTREAM_BLOCKED', err.message || '上游拒绝访问', 502, err);
  }
  if (code === 'UPSTREAM') {
    return new CapabilityError('UPSTREAM_ERROR', err.message || '上游请求失败', 502, err);
  }
  if (code === 'TIMEOUT' || (err && (err.name === 'TimeoutError' || err.name === 'AbortError'))) {
    return new CapabilityError('UPSTREAM_TIMEOUT', '上游请求超时', 504, err);
  }
  return new CapabilityError('PROVIDER_ERROR', (err && err.message) || 'Provider 调用失败', 500, err);
}

function principalId(principal) {
  if (typeof principal === 'string') return principal;
  if (principal && typeof principal.instanceId === 'string') return principal.instanceId;
  return '';
}

class CapabilityRouter {
  constructor({ registry, grants, logger, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    if (!registry) throw new TypeError('CapabilityRouter 需要 Registry');
    if (!Number.isFinite(timeoutMs) || timeoutMs < 0) throw new TypeError('timeoutMs 不能为负数');
    this._registry = registry;
    this._grants = grants || new GrantStore();
    this._logger = logger || console;
    this._timeoutMs = timeoutMs;
  }

  async invoke({
    capability,
    version,
    input,
    contract,
    providerId,
    principal,
  }) {
    if (!contract || typeof contract.normalizeInput !== 'function' || typeof contract.normalizeOutput !== 'function') {
      throw new CapabilityError('CAPABILITY_INVALID_CONTRACT', '能力契约缺少输入/输出校验', 500);
    }

    const normalized = contract.normalizeInput(input);

    if (contract.permission && principal !== undefined && principal !== null) {
      const owner = principalId(principal);
      if (!owner) throw new CapabilityError('CAPABILITY_INVALID_PRINCIPAL', 'principal 缺少 instanceId');
      const resource = typeof contract.permissionResource === 'function'
        ? contract.permissionResource(normalized)
        : undefined;
      this._grants.require(owner, contract.permission, resource);
    }

    const descriptors = providerId
      ? [this._registry.get(capability, version, providerId)].filter(Boolean)
      : this._registry.list(capability, version);

    if (!descriptors.length) {
      if (providerId) {
        throw new CapabilityError('PROVIDER_NOT_FOUND', `未知 Provider：${providerId}`, 404);
      }
      throw new CapabilityError('NO_PROVIDER', '没有可用的能力来源', 503);
    }

    const chosen = descriptors[0];
    try {
      const { invoke } = this._registry.resolve(capability, version, chosen.providerId);
      const result = await withTimeout(
        invoke(normalized, { providerId: chosen.providerId, principal: principalId(principal) || null }),
        this._timeoutMs,
        `${capability}@${version} 调用超时`,
      );
      return {
        output: contract.normalizeOutput(result, { providerId: chosen.providerId, input: normalized }),
        providerId: chosen.providerId,
      };
    } catch (err) {
      const mapped = mapProviderError(err);
      if (mapped.code === 'PROVIDER_ERROR') {
        try {
          this._logger.error('[capability] provider failed', capability, chosen.providerId, err && (err.message || err));
        } catch { /* 日志失败不影响错误返回 */ }
      }
      throw mapped;
    }
  }
}

module.exports = { CapabilityRouter, CapabilityError };
