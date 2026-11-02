/* 公开书籍字段白名单：首页/榜单/公开详情只返回这些字段。
   文件、心得、UUID/revision、自定义字段、藏书集、同步信息一律不进入公开响应。 */
const { translatorDto } = require('../core/translators');
const coreSeries = require('../core/series');

const PUBLIC_FIELDS = [
  'id', 'title', 'author', 'translators', 'status', 'summary', 'tags', 'cover',
  'start_date', 'finish_date', 'read_count', 'read_logs', 'rating',
  'publisher', 'pub_year', 'isbn', 'douban_id', 'series', 'series_index',
];

function publicBook(row) {
  if (!row) return null;
  const out = {};
  for (const key of PUBLIC_FIELDS) out[key] = row[key];
  out.series_label = coreSeries.seriesLabel(row.series, row.series_index);
  return translatorDto(out);
}

module.exports = { PUBLIC_FIELDS, publicBook };
