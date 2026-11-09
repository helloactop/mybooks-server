/* ============================================================
 * 进程内事件总线：类型化事件名 + 可撤销订阅 + 错误隔离
 *
 * 边界：
 *   · emit() 只做同步通知，异步订阅者的 rejection 被单独记录，不污染业务返回值；
 *   · emitAwait() 并行等待订阅者，逐个收集失败，不让一个订阅者拖垮其他订阅者；
 *   · 可靠投递（Outbox / eventId 持久化 / 重试）尚未实现，这里不宣称可靠事件；
 *   · 订阅者身份只用于错误归属与后续权限判断，不作为授权凭据。
 * ============================================================ */

const crypto = require('node:crypto');

const { PLUGIN_ID_RE } = require('./registry');

const EVENT_RE = /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9_]*)+$/;
const TRACE_ID_MAX = 128;

class EventError extends Error {
  constructor(code, message, status = 400) {
    super(message || code);
    this.name = 'EventError';
    this.code = code;
    this.status = status;
  }
}

function assertEventName(event) {
  if (typeof event !== 'string' || !EVENT_RE.test(event)) {
    throw new EventError('EVENT_INVALID_INPUT', '事件名必须形如 domain.action');
  }
  return event;
}

function assertInstanceId(instanceId) {
  if (instanceId === undefined) return '';
  if (typeof instanceId !== 'string' || !PLUGIN_ID_RE.test(instanceId)) {
    throw new EventError('EVENT_INVALID_INPUT', 'instanceId 不合法');
  }
  return instanceId;
}

function withTimeout(promise, ms, event) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new EventError('EVENT_HANDLER_TIMEOUT', `事件 ${event} 的订阅者超时（${ms}ms）`, 504));
    }, ms);
    if (typeof timer.unref === 'function') timer.unref();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

class EventBus {
  constructor({ logger, maxListenersPerEvent = 100, handlerTimeoutMs = 0 } = {}) {
    if (!Number.isSafeInteger(maxListenersPerEvent) || maxListenersPerEvent < 1 || maxListenersPerEvent > 10000) {
      throw new EventError('EVENT_INVALID_INPUT', 'maxListenersPerEvent 必须在 1..10000 之间');
    }
    if (!Number.isFinite(handlerTimeoutMs) || handlerTimeoutMs < 0) {
      throw new EventError('EVENT_INVALID_INPUT', 'handlerTimeoutMs 不能为负数');
    }
    this._logger = logger || console;
    this._maxListeners = maxListenersPerEvent;
    this._handlerTimeoutMs = handlerTimeoutMs;
    this._listeners = new Map();
  }

  on(event, handler, { instanceId } = {}) {
    const name = assertEventName(event);
    if (typeof handler !== 'function') {
      throw new EventError('EVENT_INVALID_INPUT', '事件处理器必须是函数');
    }
    const owner = assertInstanceId(instanceId);
    if (!this._listeners.has(name)) this._listeners.set(name, new Set());
    const records = this._listeners.get(name);
    if (records.size >= this._maxListeners) {
      throw new EventError('EVENT_LIMIT_EXCEEDED', `事件 ${name} 的订阅者超过上限`, 429);
    }

    const record = { event: name, instanceId: owner, handler, active: true };
    records.add(record);
    return () => {
      if (!record.active) return false;
      record.active = false;
      records.delete(record);
      if (records.size === 0) this._listeners.delete(name);
      return true;
    };
  }

  emit(event, payload, options = {}) {
    const name = assertEventName(event);
    const meta = this._meta(name, options);
    const failures = [];
    let notified = 0;

    for (const record of this._snapshot(name)) {
      if (!record.active) continue;
      notified += 1;
      try {
        const result = record.handler(payload, meta);
        if (result && typeof result.then === 'function') {
          Promise.resolve(result).catch((err) => this._logFailure(name, this._failure(record, err)));
        }
      } catch (err) {
        failures.push(this._failure(record, err));
      }
    }

    for (const failure of failures) this._logFailure(name, failure);
    return { event: name, eventId: meta.eventId, traceId: meta.traceId, notified, failures };
  }

  async emitAwait(event, payload, options = {}) {
    const name = assertEventName(event);
    const meta = this._meta(name, options);
    const timeoutMs = options.timeoutMs === undefined ? this._handlerTimeoutMs : options.timeoutMs;
    if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
      throw new EventError('EVENT_INVALID_INPUT', 'timeoutMs 不能为负数');
    }

    const records = this._snapshot(name).filter((record) => record.active);
    const settled = await Promise.allSettled(
      records.map((record) => this._invoke(record, payload, meta, timeoutMs)),
    );
    const failures = [];
    settled.forEach((result, index) => {
      if (result.status === 'rejected') failures.push(this._failure(records[index], result.reason));
    });
    for (const failure of failures) this._logFailure(name, failure);
    return { event: name, eventId: meta.eventId, traceId: meta.traceId, notified: records.length, failures };
  }

  listenerCount(event) {
    const name = assertEventName(event);
    return this._listeners.has(name) ? this._listeners.get(name).size : 0;
  }

  disposeAll() {
    let count = 0;
    for (const records of this._listeners.values()) {
      for (const record of records) {
        record.active = false;
        count += 1;
      }
    }
    this._listeners.clear();
    return count;
  }

  async _invoke(record, payload, meta, timeoutMs) {
    const result = record.handler(payload, meta);
    if (!result || typeof result.then !== 'function') return result;
    return timeoutMs > 0 ? withTimeout(result, timeoutMs, meta.event) : result;
  }

  _snapshot(name) {
    return [...(this._listeners.get(name) || [])];
  }

  _meta(event, options) {
    const opts = options || {};
    const traceId = opts.traceId === undefined ? crypto.randomUUID() : opts.traceId;
    if (typeof traceId !== 'string' || traceId.length === 0 || traceId.length > TRACE_ID_MAX) {
      throw new EventError('EVENT_INVALID_INPUT', 'traceId 不合法');
    }
    return Object.freeze({ event, eventId: crypto.randomUUID(), traceId });
  }

  _failure(record, err) {
    const message = err && err.message ? String(err.message) : String(err);
    return Object.freeze({
      event: record.event,
      instanceId: record.instanceId,
      code: (err && err.code) || 'EVENT_HANDLER_FAILED',
      message: message.slice(0, 500),
    });
  }

  _logFailure(event, failure) {
    const owner = this._logger;
    const fn = owner && (typeof owner.error === 'function' ? owner.error : owner.warn);
    if (typeof fn !== 'function') return;
    try {
      fn.call(owner, `[events] ${event} 订阅者 ${failure.instanceId || 'unknown'} 失败`, failure.code, failure.message);
    } catch {
      // 日志失败不能影响事件分发
    }
  }
}

module.exports = { EventBus, EventError };
