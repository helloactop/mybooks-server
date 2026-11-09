#!/usr/bin/env node
/* 把 plugin-sdk/python 的包同步进 toolbox-runtime 构建上下文。
 * 单一源仍为 plugin-sdk/python；生成目录不提交。
 * 用法：npm run sdk:sync && docker build ... toolbox-runtime
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'plugin-sdk', 'python', 'mybooks_plugin_sdk');
const targetDir = path.join(root, 'toolbox-runtime', 'sdk');
const target = path.join(targetDir, 'mybooks_plugin_sdk');

if (!fs.existsSync(source)) {
  console.error('[sdk:sync] 缺少源目录:', source);
  process.exit(1);
}

fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(targetDir, { recursive: true });
fs.cpSync(source, target, {
  recursive: true,
  filter: (item) => !item.includes('__pycache__'),
});
console.log('[sdk:sync] 已同步到', path.relative(root, target));
