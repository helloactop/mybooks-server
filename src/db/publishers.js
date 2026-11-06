// 出版社直接从在架图书聚合；不维护第二套出版社元数据或修改书籍。
const { scopeClause } = require('../core/sql');

function publisherQuery({ scopeIds = null, q = '' } = {}) {
  const clauses = ['b.deleted_at IS NULL', "TRIM(b.publisher) <> ''"];
  const params = [];
  const scope = scopeClause('b.id', scopeIds);
  if (scope) { clauses.push(scope.sql); params.push(...scope.params); }
  if (q) {
    clauses.push("TRIM(b.publisher) LIKE ? ESCAPE '\\'");
    params.push('%' + String(q).replace(/[\\%_]/g, (ch) => '\\' + ch) + '%');
  }
  return { sql: `SELECT TRIM(b.publisher) AS name, COUNT(*) AS count FROM books b WHERE ${clauses.join(' AND ')} GROUP BY TRIM(b.publisher)`, params };
}

function listPublishers(db, options) {
  const query = publisherQuery(options);
  return db.prepare(query.sql + ' ORDER BY name COLLATE NOCASE, name').all(...query.params);
}

function searchPublishers(db, { limit = 100, offset = 0, ...options } = {}) {
  const query = publisherQuery(options);
  const total = Number(db.prepare(`SELECT COUNT(*) AS n FROM (${query.sql})`).get(...query.params).n);
  const items = db.prepare(query.sql + ' ORDER BY name COLLATE NOCASE, name LIMIT ? OFFSET ?').all(...query.params, limit, offset);
  return { items, total };
}

module.exports = { listPublishers, searchPublishers };
