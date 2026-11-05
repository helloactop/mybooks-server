const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');
const source = fs.readFileSync(path.join(__dirname, '../public/js/login.js'), 'utf8');

function page({ storage, jar = { value: '' }, cookiesBlocked = false } = {}) {
  const elements = new Map();
  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, {
        addEventListener() {}, querySelectorAll: () => [], reset() {},
      });
      return elements.get(id);
    },
    get cookie() { if (cookiesBlocked) throw Error('blocked'); return jar.value; },
    set cookie(value) { if (cookiesBlocked) throw Error('blocked'); jar.value = value.split(';')[0]; },
  };
  const crypto = { randomUUID };
  const context = vm.createContext({
    document, localStorage: storage, crypto, window: { crypto }, URL, URLSearchParams,
    location: { protocol: 'https:', origin: 'https://books.test', search: '' },
    fetch: async () => ({ ok: true, status: 200, json: async () => ({ initialized: false }) }),
  });
  vm.runInContext(source, context);
  return { evaluate: (code) => vm.runInContext(code, context), jar };
}
const blockedStorage = {
  getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); }, removeItem() { throw Error('blocked'); },
};

test('网页 localStorage 不可用时通过 Cookie 跨页面复用设备标识，退出不清除标识', () => {
  const first = page({ storage: blockedStorage });
  const key = first.evaluate('deviceKey()');
  assert.ok(key);
  assert.equal(first.evaluate('deviceKey()'), key);
  assert.doesNotThrow(() => first.evaluate('clearLegacyToken()'));
  const reloaded = page({ storage: blockedStorage, jar: first.jar });
  assert.equal(reloaded.evaluate('deviceKey()'), key);
});

test('写入 localStorage 失败仍保留已有设备标识', () => {
  const current = page({ storage: { ...blockedStorage, getItem: () => 'existing-browser' } });
  assert.equal(current.evaluate('deviceKey()'), 'existing-browser');
  assert.equal(current.jar.value, 'mybooks_device_key=existing-browser');
});

test('所有持久存储均不可用时页面内重试仍使用同一标识', () => {
  const current = page({ storage: blockedStorage, cookiesBlocked: true });
  const key = current.evaluate('deviceKey()');
  assert.ok(key);
  assert.equal(current.evaluate('deviceKey()'), key);
});
