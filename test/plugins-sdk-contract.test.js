/* ============================================================
 * Phase 4B：统一能力接口契约（内部 API）
 *
 * 覆盖：任务创建/查询/结果/取消、Artifact 发布与隔离、
 *       书籍创建/更新/阅读状态、配置校验、身份不匹配、最小任务链。
 * 使用真实 express 服务 + 临时 SQLite + 真实文件系统。
 * ============================================================ */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mybooks-sdk-contract-'));
const toolboxRoot = path.join(root, 'toolbox');
process.env.MYBOOKS_STORAGE_DIR = root;
process.env.MYBOOKS_TOOLBOX_DIR = toolboxRoot;
process.env.MYBOOKS_SEED_DEMO = 'false';

const { db } = require('../src/db/index');
const toolboxRepo = require('../src/db/toolbox');

const V1_MANIFEST = {
  manifest_version: 1,
  tool_id: 'zlibrary',
  name: 'Z-Library',
  version: '0.1.0',
  description: '测试用插件',
  author: 'tester',
  core_api_version: '1.3.0',
  repo_url: 'https://example.com/zlibrary',
  runtime: { type: 'python', entry: 'tool.ZlibraryTool' },
  entry_backend: 'tool.ZlibraryTool',
  entry_frontend: 'index.html',
  config: {
    schema: {
      type: 'object',
      properties: {
        api_token: { type: 'string', 'x-sensitive': true },
        font_size: { type: 'integer', minimum: 8, maximum: 32 },
      },
      required: ['api_token'],
    },
  },
};

toolboxRepo.insertTool(db, {
  tool_id: 'zlibrary',
  name: 'Z-Library',
  revision: '0.1.0',
  install_path: 'plugins/zlibrary',
  sha256: 'a'.repeat(64),
  compatibility: { supported: true, reviewed: true, reasons: [], warnings: [] },
  manifest: { raw: V1_MANIFEST },
  pending_restart: false,
});
toolboxRepo.insertTool(db, {
  tool_id: 'demo',
  name: 'Demo',
  revision: '1.0.0',
  install_path: 'plugins/demo',
  sha256: 'b'.repeat(64),
  compatibility: { supported: true, reviewed: true, reasons: [], warnings: [] },
  manifest: { tool_id: 'demo', entry_backend: 'backend.main:Tool' },
  pending_restart: false,
});
db.close();

fs.mkdirSync(path.join(toolboxRoot, 'state'), { recursive: true });
fs.mkdirSync(path.join(toolboxRoot, 'data', 'zlibrary', 'work'), { recursive: true });
fs.writeFileSync(path.join(toolboxRoot, 'data', 'zlibrary', 'work', 'out.epub'),
  Buffer.from('PK\u0003\u0004fake epub payload'));

const GRANTS = {
  version: 1,
  tools: {
    zlibrary: [
      'books.read:library:all',
      'books.read:book:*',
      'books.write:library:all',
      'books.write:book:*',
      'metadata.read:library:all',
      'metadata.write:book:*',
      'files.write:artifact:*',
      'files.read:artifact:*',
      'jobs.create',
    ],
    demo: [
      'books.read:library:all',
      'files.read:artifact:*',
      'jobs.create',
    ],
  },
};
fs.writeFileSync(path.join(toolboxRoot, 'state', 'grants.json'), JSON.stringify(GRANTS));

function readState(name) {
  return fs.readFileSync(path.join(toolboxRoot, 'state', name), 'utf8').trim();
}

test('4B 内部能力契约与最小任务链', async () => {
  let child = null;
  let log = '';
  try {
    child = spawn(process.execPath, ['server.js'], {
      cwd: path.resolve(__dirname, '..'),
      env: {
        ...process.env,
        HOST: '127.0.0.1',
        PORT: '0',
        ADMIN_TOKEN: '',
        MYBOOKS_STORAGE_DIR: root,
        MYBOOKS_TOOLBOX_DIR: toolboxRoot,
        MYBOOKS_PUBLIC_READ: 'false',
        MYBOOKS_SEED_DEMO: 'false',
        MYBOOKS_TOOLBOX_RUNTIME_URL: 'http://127.0.0.1:1',
        MYBOOKS_TOOLBOX_PLUGIN_AUTH_ONLY: 'true',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stderr.on('data', (data) => { log += data; });
    const base = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('服务器启动超时：' + log)), 15000);
      child.once('exit', () => { clearTimeout(timer); reject(new Error('服务器退出：' + log)); });
      child.stdout.on('data', (chunk) => {
        const match = String(chunk).match(/http:\/\/localhost:(\d+)/);
        if (match) { clearTimeout(timer); resolve('http://127.0.0.1:' + match[1]); }
      });
    });

    const tokens = JSON.parse(readState('identities.json')).tokens;
    const zlib = {
      'X-Mybooks-Plugin-Id': 'zlibrary',
      'X-Mybooks-Plugin-Token': tokens.zlibrary,
    };
    const demo = {
      'X-Mybooks-Plugin-Id': 'demo',
      'X-Mybooks-Plugin-Token': tokens.demo,
    };

    async function call(pathname, { method = 'GET', body, headers = zlib } = {}) {
      const response = await fetch(base + pathname, {
        method,
        headers: { ...headers, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await response.json().catch(() => ({}));
      return { status: response.status, data };
    }

    // 1. 任务：创建 → 查询 → running 时结果 409
    const created = await call('/internal/toolbox/tasks', {
      method: 'POST',
      body: { operation: 'convert', details: { source: 'demo.md' } },
    });
    assert.equal(created.status, 201, log);
    const jobId = created.data.task_id;
    assert.ok(jobId > 0);
    assert.equal(created.data.task.status, 'running');

    const fetched = await call(`/internal/toolbox/tasks/${jobId}`);
    assert.equal(fetched.status, 200);
    assert.equal(fetched.data.task.job_id, jobId);
    assert.equal(fetched.data.task.operation, 'convert');

    const early = await call(`/internal/toolbox/tasks/${jobId}/result`);
    assert.equal(early.status, 409);
    assert.equal(early.data.code, 'TASK_NOT_FINISHED');

    // 2. 跨插件任务访问必须 403
    const crossTask = await call(`/internal/toolbox/tasks/${jobId}`, { headers: demo });
    assert.equal(crossTask.status, 403);
    assert.equal(crossTask.data.code, 'TASK_TOOL_MISMATCH');

    // 3. 无取消能力必须明确 409
    const cancel = await call(`/internal/toolbox/tasks/${jobId}/cancel`, { method: 'POST' });
    assert.equal(cancel.status, 409);
    assert.equal(cancel.data.code, 'CANCEL_UNSUPPORTED');

    // 4. 进度更新
    const progress = await call(`/internal/toolbox/tasks/${jobId}`, {
      method: 'PATCH', body: { progress: 42, stage: 'convert', message: '转换中' },
    });
    assert.equal(progress.status, 200);
    assert.equal(progress.data.task.progress, 42);

    // 5. Artifact 发布：合法
    const published = await call('/internal/toolbox/artifacts', {
      method: 'POST',
      body: { task_id: jobId, path: 'work/out.epub', format: 'epub', title: '转换结果' },
    });
    assert.equal(published.status, 201, JSON.stringify(published.data));
    const artifact = published.data.artifact;
    assert.match(artifact.artifact_id, /^art_[a-f0-9]{32}$/);
    assert.equal(artifact.task_id, jobId);
    assert.equal(artifact.format, 'EPUB');
    assert.equal(artifact.tool_id, 'zlibrary');
    assert.equal(artifact.title, '转换结果');
    assert.equal(artifact.path, undefined, '响应不得包含宿主路径');
    assert.ok(artifact.sha256.length === 64);

    // 6. Artifact 路径穿越 / 大小 / SHA 校验
    const traversal = await call('/internal/toolbox/artifacts', {
      method: 'POST', body: { task_id: jobId, path: '../../etc/passwd' },
    });
    assert.equal(traversal.status, 400);
    assert.equal(traversal.data.code, 'ARTIFACT_PATH_INVALID');

    const tooLarge = await call('/internal/toolbox/artifacts', {
      method: 'POST', body: { task_id: jobId, path: 'work/out.epub', max_bytes: 1 },
    });
    assert.equal(tooLarge.status, 400);
    assert.equal(tooLarge.data.code, 'ARTIFACT_TOO_LARGE');

    const badSha = await call('/internal/toolbox/artifacts', {
      method: 'POST', body: { task_id: jobId, path: 'work/out.epub', sha256: '0'.repeat(64) },
    });
    assert.equal(badSha.status, 400);
    assert.equal(badSha.data.code, 'ARTIFACT_SHA_MISMATCH');

    // 7. Artifact 归属隔离
    const ownArtifact = await call(`/internal/toolbox/artifacts/${artifact.artifact_id}`);
    assert.equal(ownArtifact.status, 200);
    const crossArtifact = await call(`/internal/toolbox/artifacts/${artifact.artifact_id}`, { headers: demo });
    assert.equal(crossArtifact.status, 403);
    assert.equal(crossArtifact.data.code, 'ARTIFACT_TOOL_MISMATCH');

    // 8. 书籍创建（忽略未知字段；不产生关联文件）
    const bookCreated = await call('/internal/toolbox/books', {
      method: 'POST',
      body: { title: '三体', authors: ['刘慈欣'], tags: ['科幻'], not_a_field: 'x' },
    });
    assert.equal(bookCreated.status, 201, JSON.stringify(bookCreated.data));
    const bookId = bookCreated.data.book.id;
    assert.ok(bookId > 0);
    assert.equal(bookCreated.data.book.title, '三体');
    assert.deepEqual(bookCreated.data.book.tags, ['科幻']);
    assert.equal(bookCreated.data.book.not_a_field, undefined);
    assert.deepEqual(bookCreated.data.book.files, []);

    // 9. 书籍更新（books.write）与阅读状态
    const bookUpdated = await call(`/internal/toolbox/books/${bookId}`, {
      method: 'PATCH', body: { publisher: '重庆出版社', rating: 5 },
    });
    assert.equal(bookUpdated.status, 200);
    assert.equal(bookUpdated.data.book.publisher, '重庆出版社');
    assert.equal(bookUpdated.data.book.rating, 5);

    const reading = await call(`/internal/toolbox/books/${bookId}/reading`);
    assert.equal(reading.status, 200);
    assert.equal(reading.data.reading.book_id, bookId);
    assert.equal(typeof reading.data.reading.status, 'string');
    assert.equal(reading.data.reading.read_count, 0);

    // demo 没有 books.write，更新必须 403
    const deniedUpdate = await call(`/internal/toolbox/books/${bookId}`, {
      method: 'PATCH', headers: demo, body: { title: '越权' },
    });
    assert.equal(deniedUpdate.status, 403);

    // 10. 配置校验：不泄露敏感值
    const configOk = await call('/internal/toolbox/config/validate', {
      method: 'POST', body: { values: { api_token: 'super-secret-token', font_size: 14 } },
    });
    assert.equal(configOk.status, 200, JSON.stringify(configOk.data));
    assert.equal(configOk.data.ok, true);
    assert.equal(JSON.stringify(configOk.data).includes('super-secret-token'), false);

    const configBad = await call('/internal/toolbox/config/validate', {
      method: 'POST', body: { values: { api_token: 'x', font_size: 99 } },
    });
    assert.equal(configBad.status, 200);
    assert.equal(configBad.data.ok, false);
    assert.equal(configBad.data.errors[0].field, 'font_size');

    const configMissing = await call('/internal/toolbox/config/validate', {
      method: 'POST', body: { values: { font_size: 14 } },
    });
    assert.equal(configMissing.data.ok, false);
    assert.equal(configMissing.data.errors[0].code, 'CONFIG_REQUIRED');

    // 11. 身份与 body tool_id 不一致必须拒绝
    const mismatch = await call('/internal/toolbox/books', {
      method: 'POST', body: { tool_id: 'demo', title: '冒名' },
    });
    assert.equal(mismatch.status, 403);
    assert.equal(mismatch.data.code, 'PLUGIN_IDENTITY_MISMATCH');

    // 12. 最小链路：导入产物到书库 → 完成任务 → 结果含书籍与 Artifact
    const imported = await call('/internal/toolbox/import', {
      method: 'POST',
      body: {
        task_id: jobId,
        file_path: path.join(toolboxRoot, 'data', 'zlibrary', 'work', 'out.epub'),
        title: '转换后的书',
        authors: ['刘慈欣'],
      },
    });
    assert.equal(imported.status, 200, JSON.stringify(imported.data));
    assert.ok(imported.data.book_id > 0);

    const finished = await call(`/internal/toolbox/tasks/${jobId}`, {
      method: 'PATCH',
      body: {
        status: 'completed', progress: 100, stage: 'done',
        message: '完成', result_book_id: imported.data.book_id,
      },
    });
    assert.equal(finished.status, 200);

    const result = await call(`/internal/toolbox/tasks/${jobId}/result`);
    assert.equal(result.status, 200, JSON.stringify(result.data));
    assert.equal(result.data.result.status, 'completed');
    assert.equal(result.data.result.book.id, imported.data.book_id);
    assert.equal(result.data.result.artifacts.length, 1);
    assert.equal(result.data.result.artifacts[0].artifact_id, artifact.artifact_id);
    assert.equal(JSON.stringify(result.data).includes(toolboxRoot), false, '结果不得泄露宿主路径');
  } finally {
    if (child) {
      child.kill();
      if (child.exitCode === null) await once(child, 'exit');
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
});
