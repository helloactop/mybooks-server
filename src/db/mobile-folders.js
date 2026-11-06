// App 分类来自便携快照；只读投影，不写入 Web 藏书集或改写同步数据。
function folderState(db) {
  const row = db.prepare('SELECT revision, data FROM mobile_portable_state WHERE id = 1').get();
  const data = row ? JSON.parse(row.data) : null;
  const deleted = new Map((data?.tombstones || []).map((item) => [item.namespace + ':' + item.itemId, item.deletedAt]));
  const live = (namespace, id, updatedAt) => (deleted.get(namespace + ':' + id) ?? -1) < updatedAt;
  const folders = (data?.folders || []).filter((folder) => live('folder', folder.id, folder.updatedAt));
  const ids = new Set(folders.map((folder) => folder.id));
  return { revision: row?.revision || 0, data, folders: folders.map((folder) => ({
    id: folder.id, name: folder.name, parentId: ids.has(folder.parentId) ? folder.parentId : null,
  })), links: (data?.bookFolderLinks || []).filter((link) => ids.has(link.folderId) && live('book_folder', link.bookId, link.updatedAt)) };
}

function listMobileFolders(db) {
  const { revision, folders } = folderState(db);
  return { revision, folders };
}

function mobileFolderScope(db, id) {
  if (typeof id !== 'string' || !id || id.length > 512) {
    throw Object.assign(new Error('folder 应为有效分类 ID'), { code: 'VALIDATION' });
  }
  const { data, folders, links } = folderState(db);
  if (!folders.some((folder) => folder.id === id)) return { sql: 'SELECT id FROM books WHERE 1 = 0', params: [] };
  const children = new Map();
  for (const folder of folders) {
    if (!children.has(folder.parentId)) children.set(folder.parentId, []);
    children.get(folder.parentId).push(folder.id);
  }
  const selected = new Set([id]);
  const queue = [id];
  for (let i = 0; i < queue.length; i++) for (const child of children.get(queue[i]) || []) {
    if (!selected.has(child)) { selected.add(child); queue.push(child); }
  }
  const members = links.filter((link) => selected.has(link.folderId)).flatMap((link) => {
    const match = /^mybooks-([1-9][0-9]*)$/.exec(link.bookId);
    const uuid = data.bookIdentities?.[link.bookId];
    return match && Number.isSafeInteger(Number(match[1])) && typeof uuid === 'string'
      ? [{ id: Number(match[1]), uuid }] : [];
  });
  // 单个 JSON 参数避免大分类触及 SQLite 变量上限；UUID 防止旧快照引用重用的数字 ID。
  return { sql: `SELECT b.id FROM books b JOIN json_each(?) member
    ON b.id = json_extract(member.value, '$.id') AND b.uuid = json_extract(member.value, '$.uuid')
    WHERE b.deleted_at IS NULL`, params: [JSON.stringify(members)] };
}

module.exports = { listMobileFolders, mobileFolderScope };
