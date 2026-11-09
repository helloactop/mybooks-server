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

function abortedError(message) {
  return new CapabilityError('CAPABILITY_ABORTED', message || '调用已取消', 499);
}

/**
 * 用 AbortController 统一“超时”和“外部取消”：
 *   · 超时 → abort(reason=UPSTREAM_TIMEOUT)；
 *   · 调用方 signal → abort(reason=CAPABILITY_ABORTED)。
 * Provider 收到同一个 signal 就能真正停止底层请求；不支持的旧 Provider
 * 仍会被这里的竞速包装返回，但语义上只承诺“不再等待”，不承诺已停止。
 */
async function runWithSignal(invokeFn, { timeoutMs, signal, timeoutMessage }) {
  if (signal && signal.aborted) throw abortedError('调用方已取消');

  const controller = new AbortController();
  let timer = null;
  const onOuterAbort = () => controller.abort(abortedError('调用方已取消'));

  if (signal) {
    signal.addEventListener('abort', onOuterAbort, { once: true });
  }
  if (timeoutMs) {
    timer = setTimeout(() => controller.abort(
      new CapabilityError('UPSTREAM_TIMEOUT', timeoutMessage || '调用超时', 504),
    ), timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();
  }

  try {
    const promise = Promise.resolve().then(() => invokeFn(controller.signal));
    // Provider 不支持 signal 时，仍由 abort 事件让等待方立即返回。
    const abortPromise = new Promise((_, reject) => {
      const onAbort = () => reject(controller.signal.reason || abortedError());
      if (controller.signal.aborted) onAbort();
      else controller.signal.addEventListener('abort', onAbort, { once: true });
    });
    // 竞速落败的 provider promise 仍要挂错误处理，避免 unhandled rejection。
    promise.catch(() => {});
    return await Promise.race([promise, abortPromise]);
  } catch (err) {
    if (controller.signal.aborted && err && err.name === 'AbortError') {
      throw controller.signal.reason || err;
    }
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onOuterAbort);
  }
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
    signal,
    timeoutMs,
  }) {
    if (!contract || typeof contract.normalizeInput !== 'function' || typeof contract.normalizeOutput !== 'function') {
      throw new CapabilityError('CAPABILITY_INVALID_CONTRACT', '能力契约缺少输入/输出校验', 500);
    }
    if (signal !== undefined && signal !== null && typeof signal.aborted !== 'boolean') {
      throw new CapabilityError('CAPABILITY_INVALID_SIGNAL', 'signal 必须是 AbortSignal', 400);
    }
    if (timeoutMs !== undefined && (!Number.isFinite(timeoutMs) || timeoutMs < 0)) {
      throw new CapabilityError('CAPABILITY_INVALID_TIMEOUT', 'timeoutMs 不能为负数', 400);
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
      const result = await runWithSignal(
        (callSignal) => invoke(normalized, {
          providerId: chosen.providerId,
          principal: principalId(principal) || null,
          signal: callSignal,
        }),
        {
          timeoutMs: timeoutMs === undefined ? this._timeoutMs : timeoutMs,
          signal,
          timeoutMessage: `${capability}@${version} 调用超时`,
        },
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
