const { test } = require('node:test');
const assert = require('node:assert/strict');

test('React 分类：父子层级、同名分类、专用路径和筛选参数独立于 Web 藏书集', async () => {
  const { parseLibraryFolders } = await import('../web-react/src/features/library/library-folders.ts');
  const { libraryHref, readLibraryLocation } = await import('../web-react/src/features/library/library-navigation.ts');
  const { bookQuery, isBookView } = await import('../web-react/src/features/library/library-books.ts');
  const folder = (id, name, parentId = null) => ({ id, name, parentId });
  const parsed = parseLibraryFolders({ revision: 3, folders: [folder('child / 书', '小说', 'root'), folder('other', '小说'), folder('root', '书库')] });
  assert.deepEqual(parsed.collections.map(item => [item.id, item.depth, item.path]), [['other', 0, '小说'], ['root', 0, '书库'], ['child / 书', 1, '书库 / 小说']]);
  assert.ok(parsed.collections.every(item => item.source === 'app'));
  const location = { view: 'folder', folderId: 'child / 书', query: '书', sort: 'title', page: 2, author: '作者' };
  const href = libraryHref(location);
  assert.ok(href.startsWith('/mybooks/folders/child%20%2F%20%E4%B9%A6?'));
  const url = new URL(href, 'http://localhost');
  assert.deepEqual(readLibraryLocation(url.pathname, url.search), { ...location, collectionId: undefined });
  assert.equal(readLibraryLocation('/mybooks/', '?folder=root').view, 'folder');
  assert.equal(bookQuery(location).get('folder'), location.folderId);
  assert.equal(bookQuery(location).has('collection'), false);
  assert.equal(isBookView('folder'), true);
  assert.deepEqual(parseLibraryFolders({ revision: 0, folders: [] }), { revision: 0, collections: [] });
  for (const invalid of [null, {}, { revision: 1, folders: [folder('a', 'A'), folder('a', 'B')] },
    { revision: 1, folders: [folder('a', 'A', 'b'), folder('b', 'B', 'a')] }]) {
    assert.throws(() => parseLibraryFolders(invalid));
  }
});
