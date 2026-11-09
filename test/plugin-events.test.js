const { test } = require('node:test');
const assert = require('node:assert/strict');

const { EventBus } = require('../src/core/plugins/events');

function silentLogger() {
  return { error: () => {}, warn: () => {} };
}

test('emit 通知订阅者并传递 eventId / traceId，disposer 幂等', () => {
  const bus = new EventBus({ logger: silentLogger() });
  const seen = [];
  const off = bus.on('book.imported', (payload, meta) => seen.push({ payload, meta }));
  bus.on('other.event', () => { throw new Error('不应触发'); });

  const result = bus.emit('book.imported', { bookId: 1 }, { traceId: 'trace-1' });
  assert.equal(result.notified, 1);
  assert.equal(result.failures.length, 0);
  assert.equal(result.traceId, 'trace-1');
  assert.equal(typeof result.eventId, 'string');
  assert.equal(result.eventId.length, 36);
  assert.deepEqual(seen[0].payload, { bookId: 1 });
  assert.equal(seen[0].meta.event, 'book.imported');
  assert.equal(seen[0].meta.traceId, 'trace-1');
  assert.equal(Object.isFrozen(seen[0].meta), true);

  assert.equal(off(), true);
  assert.equal(off(), false);
  assert.equal(bus.listenerCount('book.imported'), 0);
  assert.equal(bus.emit('book.imported', {}).notified, 0);
});

test('emit 隔离同步异常，不影响其他订阅者', () => {
  const bus = new EventBus({ logger: silentLogger() });
  const delivered = [];
  bus.on('book.imported', () => { throw new Error('boom'); }, { instanceId: 'inst.bad' });
  bus.on('book.imported', () => delivered.push('ok'), { instanceId: 'inst.good' });

  const result = bus.emit('book.imported', {});
  assert.equal(result.notified, 2);
  assert.deepEqual(delivered, ['ok']);
  assert.deepEqual(result.failures.map((item) => [item.instanceId, item.code, item.message]), [
    ['inst.bad', 'EVENT_HANDLER_FAILED', 'boom'],
  ]);
});

test('emit 不等待异步订阅者', async () => {
  const bus = new EventBus({ logger: silentLogger() });
  let resolved = 0;
  bus.on('job.completed', async () => {
    await new Promise((resolve) => setTimeout(resolve, 15));
    resolved += 1;
  });

  const result = bus.emit('job.completed', {});
  assert.equal(result.notified, 1);
  assert.equal(resolved, 0);

  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(resolved, 1);
});

test('emitAwait 并行等待订阅者并逐个收集失败', async () => {
  const bus = new EventBus({ logger: silentLogger() });
  const order = [];
  bus.on('book.imported', async () => {
    await new Promise((resolve) => setTimeout(resolve, 25));
    order.push('slow');
  });
  bus.on('book.imported', async () => { order.push('fast'); });
  bus.on('book.imported', async () => { throw new Error('async boom'); }, { instanceId: 'inst.async' });

  const result = await bus.emitAwait('book.imported', {});
  assert.equal(result.notified, 3);
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].instanceId, 'inst.async');
  assert.equal(result.failures[0].message, 'async boom');
  assert.deepEqual(order, ['fast', 'slow']);
});

test('emitAwait 对挂起的订阅者应用超时', async () => {
  const bus = new EventBus({ logger: silentLogger() });
  bus.on('book.imported', () => new Promise(() => {}), { instanceId: 'inst.hang' });

  const result = await bus.emitAwait('book.imported', {}, { timeoutMs: 20 });
  assert.equal(result.notified, 1);
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].code, 'EVENT_HANDLER_TIMEOUT');
});

test('分发过程中被其他订阅者撤销的监听器不会再收到事件', () => {
  const bus = new EventBus({ logger: silentLogger() });
  let secondCalled = 0;
  let offSecond;
  bus.on('book.imported', () => { offSecond(); }, { instanceId: 'inst.first' });
  offSecond = bus.on('book.imported', () => { secondCalled += 1; }, { instanceId: 'inst.second' });

  const result = bus.emit('book.imported', {});
  assert.equal(secondCalled, 0);
  assert.equal(result.notified, 1);
});

test('disposeAll 注销全部监听器，旧 disposer 幂等', () => {
  const bus = new EventBus({ logger: silentLogger() });
  const off = bus.on('book.imported', () => {});
  bus.on('job.completed', () => {});

  assert.equal(bus.disposeAll(), 2);
  assert.equal(off(), false);
  assert.equal(bus.listenerCount('book.imported'), 0);
  assert.equal(bus.emit('book.imported', {}).notified, 0);
});

test('事件名、处理器、身份与参数上限被校验', () => {
  const bus = new EventBus({ logger: silentLogger() });
  const invalidNames = ['book', 'Book.Imported', 'book..imported', '', 123];
  for (const name of invalidNames) {
    assert.throws(() => bus.on(name, () => {}), (err) => err.code === 'EVENT_INVALID_INPUT');
    assert.throws(() => bus.emit(name, {}), (err) => err.code === 'EVENT_INVALID_INPUT');
  }
  assert.throws(() => bus.on('book.imported', null), (err) => err.code === 'EVENT_INVALID_INPUT');
  assert.throws(
    () => bus.on('book.imported', () => {}, { instanceId: 'bad id' }),
    (err) => err.code === 'EVENT_INVALID_INPUT',
  );
  assert.throws(
    () => bus.emit('book.imported', {}, { traceId: 'x'.repeat(129) }),
    (err) => err.code === 'EVENT_INVALID_INPUT',
  );
  assert.throws(
    () => bus.emit('book.imported', {}, { traceId: '' }),
    (err) => err.code === 'EVENT_INVALID_INPUT',
  );
});

test('构造参数与订阅者数量上限被校验', async () => {
  assert.throws(() => new EventBus({ maxListenersPerEvent: 0 }), (err) => err.code === 'EVENT_INVALID_INPUT');
  assert.throws(() => new EventBus({ handlerTimeoutMs: -1 }), (err) => err.code === 'EVENT_INVALID_INPUT');

  const bus = new EventBus({ logger: silentLogger(), maxListenersPerEvent: 1 });
  bus.on('book.imported', () => {});
  assert.throws(
    () => bus.on('book.imported', () => {}),
    (err) => err.code === 'EVENT_LIMIT_EXCEEDED' && err.status === 429,
  );

  await assert.rejects(
    () => bus.emitAwait('book.imported', {}, { timeoutMs: -1 }),
    (err) => err.code === 'EVENT_INVALID_INPUT',
  );
});
