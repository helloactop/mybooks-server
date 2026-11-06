export interface AccountProfile { nickname: string; avatarPath: string | null; avatarMime: string; }
const imageTypes: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif', bmp: 'image/bmp' };
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/** 资料来自已确认的便携快照；只解析个人资料，不使用设备本地路径或任意外链。 */
export function parseAccountProfile(response: unknown): AccountProfile {
  const empty: AccountProfile = { nickname: '', avatarPath: null, avatarMime: '' };
  if (!record(response) || !record(response.data)) return empty;
  const { preferences, assets } = response.data;
  if (!Array.isArray(preferences)) return empty;
  const preference = (key: string) => preferences.find((item: unknown) => record(item) && item.key === key) as Record<string, unknown> | undefined;
  const name = preference('nickname');
  const nickname = name?.type === 'string' && typeof name.value === 'string' ? name.value.trim() : '';
  // 当前 Android 使用 avatar_uri；兼容历史快照的 avatar_path，显式删除不回退旧值。
  const avatar = preference('avatar_uri') ?? preference('avatar_path');
  const id = avatar?.type === 'string' && typeof avatar.value === 'string'
    ? /^(?:file:\/\/)?asset:\/\/([a-f0-9]{64}(?:-[a-f0-9]{16})?)$/.exec(avatar.value)?.[1] : undefined;
  if (!id || !Array.isArray(assets)) return { ...empty, nickname };
  const asset = assets.find((item: unknown) => record(item) && item.id === id && item.kind === 'avatar' && item.ownerId === 'profile');
  if (!record(asset) || typeof asset.fileName !== 'string') return { ...empty, nickname };
  const match = /^([a-f0-9]{64})\.([a-z0-9]{1,10})$/.exec(asset.fileName);
  const avatarMime = match ? imageTypes[match[2]] : '';
  if (!match || !avatarMime || !(id === match[1] || id.startsWith(match[1] + '-'))) return { ...empty, nickname };
  return { nickname, avatarPath: '/api/sync/state/assets/' + asset.fileName, avatarMime };
}
