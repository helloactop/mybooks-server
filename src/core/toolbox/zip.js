/* ============================================================
 * 安装包解压：只接受 ZIP，逐项校验路径/符号链接/压缩比
 *
 * 7z 明确拒绝（第一版不引入 7z 依赖），而不是假装解压失败。
 * 失败时调用方负责删除半成品目录；本模块只保证不越界写文件。
 * ============================================================ */

const fs = require('node:fs');
const path = require('node:path');
const yauzl = require('yauzl');
const Seven = require('node-7z');
const sevenBin = require('7zip-bin');

const { ToolboxError, assertInside } = require('./security');

const ZIP_MAGIC = [Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from([0x50, 0x4b, 0x05, 0x06])];
const SEVEN_ZIP_MAGIC = Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]);

const LIMITS = {
  maxEntries: 2000,
  maxEntryBytes: 100 * 1024 * 1024,
  maxTotalBytes: 200 * 1024 * 1024,
  maxCompressionRatio: 200,
};

function detectArchiveKind(filePath) {
  const header = Buffer.alloc(8);
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    fs.readSync(fd, header, 0, 8, 0);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
  if (ZIP_MAGIC.some((magic) => header.subarray(0, magic.length).equals(magic))) return 'zip';
  if (header.subarray(0, SEVEN_ZIP_MAGIC.length).equals(SEVEN_ZIP_MAGIC)) return '7z';
  return 'unknown';
}

function openZip(filePath) {
  return new Promise((resolve, reject) => {
    yauzl.open(filePath, { lazyEntries: true, autoClose: false, decodeStrings: true, validateEntrySizes: true },
      (err, zip) => (err ? reject(err) : resolve(zip)));
  });
}

function nextEntry(zip) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      zip.removeListener('entry', onEntry);
      zip.removeListener('end', onEnd);
      zip.removeListener('error', onError);
    };
    const onEntry = (entry) => { cleanup(); resolve(entry); };
    const onEnd = () => { cleanup(); resolve(null); };
    const onError = (err) => { cleanup(); reject(err); };
    zip.once('entry', onEntry);
    zip.once('end', onEnd);
    zip.once('error', onError);
    zip.readEntry();
  });
}

function entryMode(entry) {
  return (entry.externalFileAttributes >>> 16) & 0xffff;
}

function isSymlink(entry) {
  return (entryMode(entry) & 0o170000) === 0o120000;
}

function isDirectory(entry) {
  return entry.fileName.endsWith('/') || (entryMode(entry) & 0o170000) === 0o040000;
}

function validateEntryName(name) {
  const value = String(name || '');
  if (!value || value.includes('\0') || value.includes('\\')) {
    throw new ToolboxError('ARCHIVE_PATH_INVALID', '安装包包含非法路径');
  }
  if (value.startsWith('/') || /^[a-zA-Z]:/.test(value)) {
    throw new ToolboxError('ARCHIVE_PATH_INVALID', '安装包包含绝对路径');
  }
  const segments = value.replace(/\/$/, '').split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..' || segment.startsWith('.'))) {
    throw new ToolboxError('ARCHIVE_PATH_INVALID', `安装包包含不安全路径：${value}`);
  }
  return segments;
}

function writeEntry(zip, entry, targetPath, expectedBytes) {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (err, stream) => {
      if (err) return reject(err);
      const out = fs.createWriteStream(targetPath, { mode: 0o644, flags: 'wx' });
      let written = 0;
      let settled = false;
      const fail = (error) => {
        if (settled) return;
        settled = true;
        stream.destroy();
        out.destroy();
        reject(error);
      };
      stream.on('data', (chunk) => {
        written += chunk.length;
        if (written > expectedBytes || written > LIMITS.maxEntryBytes) {
          fail(new ToolboxError('ARCHIVE_TOO_LARGE', '安装包内文件超过大小上限'));
        }
      });
      stream.on('error', fail);
      out.on('error', fail);
      out.on('finish', () => {
        if (settled) return;
        settled = true;
        if (written !== expectedBytes) {
          reject(new ToolboxError('ARCHIVE_CORRUPT', '安装包内容与目录声明不一致'));
          return;
        }
        resolve(written);
      });
      stream.pipe(out);
    });
  });
}

async function extractZip(archivePath, destDir, { limits = LIMITS } = {}) {
  const kind = detectArchiveKind(archivePath);
  if (kind === '7z') {
    throw new ToolboxError('ARCHIVE_UNSUPPORTED', '该安装包是 7z 格式；第一版仅支持 ZIP，请等待商店提供 ZIP 或更新宿主');
  }
  if (kind !== 'zip') throw new ToolboxError('ARCHIVE_UNSUPPORTED', '不支持的安装包格式，仅支持 ZIP');

  fs.mkdirSync(destDir, { recursive: true });
  const root = path.resolve(destDir);
  let zip;
  try {
    zip = await openZip(archivePath);
  } catch {
    throw new ToolboxError('ARCHIVE_INVALID', '不是合法的 ZIP 安装包');
  }

  let entries = 0;
  let totalBytes = 0;
  try {
    while (true) {
      const entry = await nextEntry(zip);
      if (!entry) break;
      entries += 1;
      if (entries > limits.maxEntries) {
        throw new ToolboxError('ARCHIVE_TOO_MANY_ENTRIES', '安装包文件数量超过上限');
      }
      const segments = validateEntryName(entry.fileName);
      if (isSymlink(entry)) {
        throw new ToolboxError('ARCHIVE_SYMLINK', '安装包包含符号链接，已拒绝');
      }

      const target = assertInside(root, path.join(root, ...segments), 'ARCHIVE_PATH_INVALID');
      if (isDirectory(entry)) {
        fs.mkdirSync(target, { recursive: true, mode: 0o755 });
        continue;
      }

      const size = Number(entry.uncompressedSize);
      if (!Number.isSafeInteger(size) || size < 0 || size > limits.maxEntryBytes) {
        throw new ToolboxError('ARCHIVE_TOO_LARGE', '安装包内单文件超过大小上限');
      }
      if (size > 0 && (!entry.compressedSize || size / entry.compressedSize > limits.maxCompressionRatio)) {
        throw new ToolboxError('ARCHIVE_BOMB', '安装包压缩比异常，已拒绝');
      }
      totalBytes += size;
      if (totalBytes > limits.maxTotalBytes) {
        throw new ToolboxError('ARCHIVE_TOO_LARGE', '安装包解压后总大小超过上限');
      }
      if ((entry.generalPurposeBitFlag & 0x1) !== 0) {
        throw new ToolboxError('ARCHIVE_ENCRYPTED', '不支持加密的 ZIP 安装包');
      }

      fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o755 });
      await writeEntry(zip, entry, target, size);
    }
  } catch (err) {
    if (err instanceof ToolboxError) throw err;
    if (/invalid relative path|absolute path/i.test(String(err.message || ''))) {
      throw new ToolboxError('ARCHIVE_PATH_INVALID', '安装包包含非法路径');
    }
    throw new ToolboxError('ARCHIVE_INVALID', `解压安装包失败：${err.message || err}`);
  } finally {
    try { zip.close(); } catch { /* 已关闭 */ }
  }
  return { entries, totalBytes };
}

function list7z(archivePath) {
  return new Promise((resolve, reject) => {
    const items = [];
    Seven.list(archivePath, { $bin: sevenBin.path7za })
      .on('data', (item) => items.push(item))
      .on('end', () => resolve(items))
      .on('error', (err) => reject(new ToolboxError('ARCHIVE_INVALID', `读取 7z 目录失败：${err.message || err}`)));
  });
}

function validate7zList(items, archiveSize, limits) {
  if (!items.length) throw new ToolboxError('ARCHIVE_INVALID', '7z 安装包为空');
  if (items.length > limits.maxEntries) throw new ToolboxError('ARCHIVE_TOO_MANY_ENTRIES', '安装包文件数量超过上限');
  let total = 0;
  for (const item of items) {
    const rawName = String(item.file || '');
    validateEntryName(rawName);
    const attributes = String(item.attributes || '');
    // 7-Zip 的 Unix 属性里 symlink 带 l/L；目录为 D。显式拒绝，避免解压出可穿越链接。
    if (/[lL]/.test(attributes)) {
      throw new ToolboxError('ARCHIVE_SYMLINK', '安装包包含符号链接，已拒绝');
    }
    const size = Number(item.size) || 0;
    if (size < 0 || size > limits.maxEntryBytes) {
      throw new ToolboxError('ARCHIVE_TOO_LARGE', '安装包内单文件超过大小上限');
    }
    total += size;
    if (total > limits.maxTotalBytes) {
      throw new ToolboxError('ARCHIVE_TOO_LARGE', '安装包解压后总大小超过上限');
    }
  }
  if (archiveSize > 0 && total / archiveSize > 500) {
    throw new ToolboxError('ARCHIVE_BOMB', '安装包压缩比异常，已拒绝');
  }
  return total;
}

function extract7z(archivePath, destDir, limits) {
  return list7z(archivePath).then((items) => {
    validate7zList(items, fs.statSync(archivePath).size, limits);
    return new Promise((resolve, reject) => {
      const stream = Seven.extractFull(archivePath, destDir, {
        $bin: sevenBin.path7za,
        recursive: true,
      });
      let settled = false;
      stream.on('end', () => {
        if (settled) return;
        settled = true;
        try {
          // 解压后再扫一遍：防止 7za 版本差异把链接/越界路径写出来。
          const walk = (dir) => {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
              const full = path.join(dir, entry.name);
              const stat = fs.lstatSync(full);
              if (stat.isSymbolicLink()) {
                throw new ToolboxError('ARCHIVE_SYMLINK', '安装包包含符号链接，已拒绝');
              }
              assertInside(destDir, full, 'ARCHIVE_PATH_INVALID');
              if (stat.isDirectory()) walk(full);
            }
          };
          walk(destDir);
          resolve({ entries: items.length, totalBytes: items.reduce((sum, item) => sum + (Number(item.size) || 0), 0) });
        } catch (err) {
          reject(err);
        }
      });
      stream.on('error', (err) => {
        if (settled) return;
        settled = true;
        reject(new ToolboxError('ARCHIVE_INVALID', `解压 7z 失败：${err.message || err}`));
      });
    });
  });
}

async function extractArchive(archivePath, destDir, { limits = LIMITS } = {}) {
  const kind = detectArchiveKind(archivePath);
  fs.mkdirSync(destDir, { recursive: true });
  if (kind === 'zip') return extractZip(archivePath, destDir, { limits });
  if (kind === '7z') return extract7z(archivePath, destDir, limits);
  throw new ToolboxError('ARCHIVE_UNSUPPORTED', '不支持的安装包格式，仅支持 ZIP / 7z');
}

module.exports = { detectArchiveKind, extractZip, extractArchive, LIMITS };
