const { test } = require('node:test');
const assert = require('node:assert/strict');

const { PERMISSIONS, GrantStore } = require('../src/core/plugins/permissions');

test('权限目录覆盖规范 6.3 的能力分类', () => {
  assert.deepEqual(Object.values(PERMISSIONS).sort(), [
    'books.delete', 'books.read', 'books.write',
    'files.read', 'files.write',
    'jobs.create',
    'metadata.read', 'metadata.write',
    'network.private', 'network.public',
    'settings.read', 'ui.contribute',
  ]);
});

test('默认拒绝，授权后 require 通过', () => {
  const grants = new GrantStore();
  assert.equal(grants.has('inst.a', PERMISSIONS.METADATA_READ), false);
  assert.throws(
    () => grants.require('inst.a', PERMISSIONS.METADATA_READ),
    (err) => err.code === 'PERMISSION_DENIED' && err.status === 403,
  );

  assert.equal(grants.grant('inst.a', PERMISSIONS.METADATA_READ), true);
  assert.equal(grants.grant('inst.a', PERMISSIONS.METADATA_READ), false, '重复授权幂等');
  assert.equal(grants.has('inst.a', PERMISSIONS.METADATA_READ), true);
  assert.equal(grants.require('inst.a', PERMISSIONS.METADATA_READ), true);
});

test('scope 支持精确值与前缀通配', () => {
  const grants = new GrantStore();
  grants.grant('inst.a', PERMISSIONS.BOOKS_READ, 'book:1');
  assert.equal(grants.has('inst.a', PERMISSIONS.BOOKS_READ, 'book:1'), true);
  assert.equal(grants.has('inst.a', PERMISSIONS.BOOKS_READ, 'book:2'), false);

  grants.grant('inst.a', PERMISSIONS.FILES_READ, 'artifact:*');
  assert.equal(grants.has('inst.a', PERMISSIONS.FILES_READ, 'artifact:abc'), true);
  assert.equal(grants.has('inst.a', PERMISSIONS.FILES_READ, 'book:1'), false);
  assert.equal(grants.has('inst.a', PERMISSIONS.FILES_READ), true, '不带资源时做粗粒度检查');
});

test('撤销单个权限、单个 scope 与全部权限', () => {
  const grants = new GrantStore();
  grants.grant('inst.a', PERMISSIONS.BOOKS_READ, 'book:1');
  grants.grant('inst.a', PERMISSIONS.BOOKS_READ, 'book:2');
  grants.grant('inst.a', PERMISSIONS.METADATA_READ);

  assert.equal(grants.revoke('inst.a', PERMISSIONS.BOOKS_READ, 'book:1'), true);
  assert.equal(grants.revoke('inst.a', PERMISSIONS.BOOKS_READ, 'book:1'), false, '重复撤销幂等');
  assert.equal(grants.has('inst.a', PERMISSIONS.BOOKS_READ, 'book:1'), false);
  assert.equal(grants.has('inst.a', PERMISSIONS.BOOKS_READ, 'book:2'), true);

  assert.equal(grants.revoke('inst.a', PERMISSIONS.METADATA_READ), true);
  assert.equal(grants.has('inst.a', PERMISSIONS.METADATA_READ), false);

  assert.equal(grants.revokeAll('inst.a'), 1);
  assert.equal(grants.revokeAll('inst.a'), 0);
});

test('未知权限、未知实例与非法输入一律拒绝', () => {
  const grants = new GrantStore();
  assert.throws(() => grants.grant('inst.a', 'root.all'), (err) => err.code === 'PERMISSION_INVALID');
  assert.throws(() => grants.grant('bad id', PERMISSIONS.BOOKS_READ), (err) => err.code === 'PERMISSION_INVALID');
  assert.throws(
    () => grants.grant('inst.a', PERMISSIONS.BOOKS_READ, 'has space'),
    (err) => err.code === 'PERMISSION_INVALID',
  );
  assert.equal(grants.has('inst.a', 'root.all'), false);
  assert.equal(grants.has('missing', PERMISSIONS.BOOKS_READ), false);
});

test('list 返回排序后的授权快照', () => {
  const grants = new GrantStore();
  grants.grant('inst.a', PERMISSIONS.METADATA_WRITE, 'book:2');
  grants.grant('inst.a', PERMISSIONS.METADATA_WRITE, 'book:1');
  grants.grant('inst.a', PERMISSIONS.BOOKS_READ);

  const items = grants.list('inst.a');
  assert.deepEqual(items, [
    { permission: 'books.read', scopes: ['*'] },
    { permission: 'metadata.write', scopes: ['book:1', 'book:2'] },
  ]);
  assert.equal(Object.isFrozen(items), true);
  assert.deepEqual(grants.list('missing'), []);
});

test('dispose 清空全部授权', () => {
  const grants = new GrantStore();
  grants.grant('inst.a', PERMISSIONS.BOOKS_READ);
  grants.grant('inst.b', PERMISSIONS.BOOKS_WRITE);
  assert.equal(grants.dispose(), 2);
  assert.equal(grants.has('inst.a', PERMISSIONS.BOOKS_READ), false);
  assert.equal(grants.dispose(), 0);
});
