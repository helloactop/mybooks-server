const { test } = require('node:test');
const assert = require('node:assert/strict');

test('React 个人资料：从同步偏好读取昵称和头像，兼容资源 ID 与旧字段', async () => {
  const { parseAccountProfile } = await import('../web-react/src/features/auth/account-profile.ts');
  const sha = 'a'.repeat(64), id = sha + '-' + 'b'.repeat(16);
  const asset = { id, kind: 'avatar', ownerId: 'profile', fileName: sha + '.jpg' };
  const preferences = [
    { key: 'nickname', type: 'string', value: '  服务器昵称  ' },
    { key: 'avatar_uri', type: 'string', value: 'asset://' + id },
  ];
  const profile = (prefs = preferences, assets = [asset]) => parseAccountProfile({ revision: 2, data: { preferences: prefs, assets } });
  assert.deepEqual(profile(), { nickname: '服务器昵称', avatarPath: '/api/sync/state/assets/' + sha + '.jpg', avatarMime: 'image/jpeg' });
  assert.equal(profile([{ key: 'avatar_path', type: 'string', value: 'asset://' + id }]).avatarPath.endsWith('.jpg'), true);
  assert.equal(profile([{ key: 'avatar_uri', type: 'string', value: 'file://asset://' + id }]).avatarPath.endsWith('.jpg'), true);
  assert.equal(profile([{ key: 'nickname', type: 'deleted', value: '旧昵称' }]).nickname, '');
  assert.equal(profile([{ key: 'nickname', type: 'int', value: '123' }]).nickname, '');
  assert.equal(profile([
    { key: 'avatar_uri', type: 'deleted', value: '' },
    { key: 'avatar_path', type: 'string', value: 'asset://' + id },
  ]).avatarPath, null, '明确删除头像时不显示旧值');
  for (const value of ['/storage/emulated/0/avatar.jpg', 'https://example.test/avatar.jpg', 'javascript:alert(1)', 'asset://' + id + '/../../secret']) {
    assert.equal(profile([{ key: 'avatar_uri', type: 'string', value }]).avatarPath, null);
  }
  for (const change of [{ kind: 'font' }, { ownerId: 'other' }, { fileName: '../avatar.jpg' }, { fileName: sha + '.html' }, { fileName: 'c'.repeat(64) + '.jpg' }]) {
    assert.equal(profile(preferences, [{ ...asset, ...change }]).avatarPath, null);
  }
  assert.equal(profile(preferences, []).avatarPath, null);
  assert.equal(profile(preferences, []).nickname, '服务器昵称', '缺头像不影响昵称');
  for (const response of [null, {}, { data: null }, { data: { preferences: null, assets: [] } }]) {
    assert.deepEqual(parseAccountProfile(response), { nickname: '', avatarPath: null, avatarMime: '' });
  }
});
