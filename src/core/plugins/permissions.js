/* ============================================================
 * 插件权限：目录、授权范围与拒绝默认
 *
 * 只做“有没有权限”的判定，不执行数据库/文件/网络操作。
 * 权限撤销立即生效；未知权限与未知实例一律按拒绝处理。
 * ============================================================ */

const { PLUGIN_ID_RE } = require('./registry');

const PERMISSIONS = Object.freeze({
  BOOKS_READ: 'books.read',
  BOOKS_WRITE: 'books.write',
  BOOKS_DELETE: 'books.delete',
  METADATA_READ: 'metadata.read',
  METADATA_WRITE: 'metadata.write',
  FILES_READ: 'files.read',
  FILES_WRITE: 'files.write',
  NETWORK_PUBLIC: 'network.public',
  NETWORK_PRIVATE: 'network.private',
  JOBS_CREATE: 'jobs.create',
  SETTINGS_READ: 'settings.read',
  UI_CONTRIBUTE: 'ui.contribute',
});

const PERMISSION_SET = new Set(Object.values(PERMISSIONS));
const SCOPE_ALL = '*';

// 这类权限的语义绑定具体资源（book:1 / library:all / artifact:x）。
// 展示性查询 can() 可以省略 resource，但真正执行操作时必须给出资源范围。
const RESOURCE_SCOPED = new Set([
  PERMISSIONS.BOOKS_READ,
  PERMISSIONS.BOOKS_WRITE,
  PERMISSIONS.BOOKS_DELETE,
  PERMISSIONS.FILES_READ,
  PERMISSIONS.FILES_WRITE,
  PERMISSIONS.METADATA_WRITE,
]);

class PermissionError extends Error {
  constructor(code, message, status = 400) {
    super(message || code);
    this.name = 'PermissionError';
    this.code = code;
    this.status = status;
  }
}

function assertInstanceId(instanceId) {
  if (typeof instanceId !== 'string' || !PLUGIN_ID_RE.test(instanceId)) {
    throw new PermissionError('PERMISSION_INVALID', 'instanceId 不合法');
  }
  return instanceId;
}

function assertPermission(permission) {
  if (typeof permission !== 'string' || !PERMISSION_SET.has(permission)) {
    throw new PermissionError('PERMISSION_INVALID', `未知权限：${permission}`);
  }
  return permission;
}

function assertScope(scope) {
  if (scope === SCOPE_ALL) return scope;
  if (typeof scope !== 'string' || scope.length === 0 || scope.length > 128 || /\s/.test(scope)) {
    throw new PermissionError('PERMISSION_INVALID', 'scope 不合法');
  }
  if (/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(scope)) return scope;
  if (/^[A-Za-z0-9][A-Za-z0-9._:/-]*:\*$/.test(scope)) return scope;
  throw new PermissionError('PERMISSION_INVALID', 'scope 不合法');
}

function matchesScope(scope, resource) {
  if (scope === SCOPE_ALL) return true;
  if (resource === undefined || resource === null) return true;
  const value = String(resource);
  if (scope.endsWith(':*')) return value.startsWith(scope.slice(0, -1));
  return scope === value;
}

class GrantStore {
  constructor() {
    this._byInstance = new Map();
  }

  grant(instanceId, permission, scope = SCOPE_ALL) {
    assertInstanceId(instanceId);
    assertPermission(permission);
    assertScope(scope);
    if (!this._byInstance.has(instanceId)) this._byInstance.set(instanceId, new Map());
    const perms = this._byInstance.get(instanceId);
    if (!perms.has(permission)) perms.set(permission, new Set());
    const scopes = perms.get(permission);
    if (scopes.has(scope)) return false;
    scopes.add(scope);
    return true;
  }

  revoke(instanceId, permission, scope) {
    assertInstanceId(instanceId);
    assertPermission(permission);
    const perms = this._byInstance.get(instanceId);
    if (!perms || !perms.has(permission)) return false;
    if (scope === undefined) {
      perms.delete(permission);
    } else {
      const scopes = perms.get(permission);
      if (!scopes.delete(assertScope(scope))) return false;
      if (scopes.size === 0) perms.delete(permission);
    }
    if (perms.size === 0) this._byInstance.delete(instanceId);
    return true;
  }

  revokeAll(instanceId) {
    assertInstanceId(instanceId);
    const perms = this._byInstance.get(instanceId);
    if (!perms) return 0;
    const count = perms.size;
    this._byInstance.delete(instanceId);
    return count;
  }

  /**
   * 展示性权限查询：resource 省略时回答“是否持有该权限的任意范围”。
   * 不能用于敏感操作授权，敏感路径请用 require()。
   */
  has(instanceId, permission, resource) {
    if (typeof instanceId !== 'string' || !PLUGIN_ID_RE.test(instanceId)) return false;
    if (typeof permission !== 'string' || !PERMISSION_SET.has(permission)) return false;
    const scopes = this._byInstance.get(instanceId) && this._byInstance.get(instanceId).get(permission);
    if (!scopes) return false;
    for (const scope of scopes) {
      if (matchesScope(scope, resource)) return true;
    }
    return false;
  }

  /**
   * 敏感操作授权：资源绑定的权限必须显式给出 resource，避免省略参数
   * 退化成“持有任意范围”。scope 为 '*' 时只表示该实例被授予全部资源，
   * 但仍需调用方声明本次操作作用于哪个资源。
   */
  require(instanceId, permission, resource) {
    if (typeof permission === 'string' && RESOURCE_SCOPED.has(permission)) {
      if (resource === undefined || resource === null || String(resource).trim() === '') {
        throw new PermissionError(
          'PERMISSION_RESOURCE_REQUIRED',
          `权限 ${permission} 需要明确资源范围`,
          403,
        );
      }
    }
    if (!this.has(instanceId, permission, resource)) {
      throw new PermissionError('PERMISSION_DENIED', `缺少权限：${permission}`, 403);
    }
    return true;
  }

  list(instanceId) {
    assertInstanceId(instanceId);
    const perms = this._byInstance.get(instanceId);
    if (!perms) return Object.freeze([]);
    const items = [...perms.keys()].sort().map((permission) => Object.freeze({
      permission,
      scopes: Object.freeze([...perms.get(permission)].sort()),
    }));
    return Object.freeze(items);
  }

  dispose() {
    const count = this._byInstance.size;
    this._byInstance.clear();
    return count;
  }
}

module.exports = { PERMISSIONS, SCOPE_ALL, PermissionError, GrantStore };
