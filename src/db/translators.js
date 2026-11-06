const { scopeClause } = require('../core/sql');
const { parseTranslators } = require('../core/translators');

function listTranslators(db, { scopeIds = null } = {}) {
  const scope = scopeClause('id', scopeIds);
  const rows = db.prepare(`SELECT translators FROM books WHERE deleted_at IS NULL${scope ? ` AND ${scope.sql}` : ''} ORDER BY id`).all(...(scope?.params || []));
  const counts = new Map();
  for (const row of rows) {
    for (const name of parseTranslators(row.translators)) {
      const key = name.toLowerCase();
      const item = counts.get(key) || { name, count: 0 };
      item.count++; counts.set(key, item);
    }
  }
  return [...counts.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function searchTranslators(db, { q = '', limit = 100, offset = 0, ...options } = {}) {
  const query = String(q).toLowerCase();
  const matches = listTranslators(db, options).filter((item) => item.name.toLowerCase().includes(query));
  return { items: matches.slice(offset, offset + limit), total: matches.length };
}

module.exports = { listTranslators, searchTranslators };
