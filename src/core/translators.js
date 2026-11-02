// 与 tags 一样使用 JSON TEXT 持久化，对外始终返回数组；姓名不进入作者表。
function parseTranslators(raw) {
  if (typeof raw === 'string') {
    const text = raw.trim();
    if (text.startsWith('[')) {
      try { raw = JSON.parse(text); } catch { return []; }
    } else raw = text.split(/[、;；/&]+/);
  }
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  return raw.filter((name) => typeof name === 'string').map((name) => name.replace(/\s+/g, ' ').trim())
    .filter((name) => {
      const key = name.toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function translatorDto(row) {
  if (!row) return row;
  const translators = parseTranslators(row.translators);
  return { ...row, translators, translators_display: translators.join('、') };
}

module.exports = { parseTranslators, translatorDto };
