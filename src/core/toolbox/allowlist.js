/* ============================================================
 * 已审查插件 allowlist
 *
 * 商店中的 ZIP 校验通过 ≠ 代码可信。第一版只允许运行人工审查过的
 * tool_id + revision + 安装包 SHA-256 组合；其他工具仍在商店展示，
 * 但明确标记“待审查”，不自动下载/运行。
 * ============================================================ */

const REVIEWED = [
  {
    tool_id: 'zlibrary',
    revision: '0.1.0',
    sha256: 'de770be426bba247eca04ad8470f9deff9deee277e7ae659eed2e10c0cba3f7a',
    reviewed_at: '2026-11-08',
    notes: '首个兼容样例：Zip + manifest 1.3.0 + 原生前端 + 7 个 API 路由',
    limitations: [
      '入库文件上限 80MB、格式限 EPUB/PDF/MOBI/AZW/AZW3/TXT；FB2/DJVU/CBZ/CBR 会被明确拒绝',
      'guest_enabled 只影响插件选择游客下载，不改变 Mybooks 登录要求',
      '单 worker 串行下载；插件运行在共享 Python 进程内',
    ],
  },
];

// 兼容性审查矩阵（不是安全审查）：用于 UI 说明已实现哪些上游能力、
// 哪些是本项目的明确限制。未在 REVIEWED 里的插件仍需管理员显式 opt-in。
const COMPATIBILITY = {
  zlibrary: {
    type: 'network + native UI + async task + import',
    status: 'compatible',
    notes: ['真实健康检查在网络可达时可用；本机 Windows 实测 entry.unreachable，Ubuntu 已由用户验证成功'],
    limitations: ['80MB / EPUB,PDF,MOBI,AZW,AZW3,TXT', '单 Worker 串行下载', 'guest_enabled 不改变主站登录要求'],
  },
  md_to_epub: {
    type: 'file conversion + multipart upload + binary download + import',
    status: 'compatible',
    notes: ['bridge FormData、原生下载链接由父页面代取', '转换后可选择入库'],
    limitations: ['上传上限 100MB', '入库沿用 Mybooks 格式/大小白名单'],
  },
  book_dedup: {
    type: 'library query + metadata + merge/delete + background task',
    status: 'compatible',
    notes: ['使用 BackgroundService 内存任务 + CoreAPI 书库读写', '删除映射为 Mybooks 回收站（可恢复）'],
    limitations: ['只复制目标缺少的格式；同名格式不复制', '被删书的阅读进度等应用侧数据不迁移'],
  },
  quality_check: {
    type: 'library query + file/cover export + background task',
    status: 'compatible_with_limits',
    notes: ['书库字段、格式文件、封面通过内部适配器提供'],
    limitations: ['仅能读取 /uploads 本地封面；外链封面返回缺失', '报告为只读，不改书'],
  },
  epub_translator: {
    type: 'library query + EPUB export + LLM network + new book import',
    status: 'compatible_with_limits',
    notes: ['书库搜索/格式导出/新书入库/二进制结果下载已适配'],
    limitations: ['LLM 网络与 API Key 由用户配置', '翻译任务在单 Worker 中串行'],
  },
  tags_cleaner: {
    type: 'library query + metadata write + background task',
    status: 'compatible',
    notes: ['set_metadata 映射为 Mybooks 标签替换'],
    limitations: ['仅处理标签规则，不改其他字段'],
  },
  mbti_tester: {
    type: 'library facets + custom fields',
    status: 'compatible',
    notes: ['get_field_map 支持 tags / #category'],
    limitations: ['无 category 自定义字段时按空值统计'],
  },
  audiobook_srt: {
    type: 'audio directory + external deps + background task',
    status: 'limited',
    notes: ['插件可加载；Mybooks 目前没有有声书目录'],
    limitations: ['默认 audio_output_folder 为空目录，扫描不到有声书', 'faster-whisper 依赖/模型需在运行卷安装'],
  },
};

function getReview(toolId, revision) {
  return REVIEWED.find((item) => item.tool_id === toolId && item.revision === revision) || null;
}

function isReviewed(toolId, revision) {
  return !!getReview(toolId, revision);
}

function getCompatibility(toolId) {
  return COMPATIBILITY[toolId] || null;
}

function allowUnreviewed() {
  return process.env.MYBOOKS_TOOLBOX_ALLOW_UNREVIEWED === 'true';
}

function shaMatches(review, sha256) {
  return !!review && String(review.sha256).toLowerCase() === String(sha256 || '').toLowerCase();
}

module.exports = { REVIEWED, COMPATIBILITY, getReview, isReviewed, getCompatibility, allowUnreviewed, shaMatches };
