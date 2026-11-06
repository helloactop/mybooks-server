import type { LibraryCollection } from './library-navigation';

export function parseLibraryFolders(data: unknown): { revision: number; collections: LibraryCollection[] } {
  if (!data || typeof data !== 'object' || !('revision' in data) || !Number.isSafeInteger(data.revision) || Number(data.revision) < 0 ||
      !('folders' in data) || !Array.isArray(data.folders)) throw new Error('folders-invalid');
  const folders = data.folders.map((item: unknown) => {
    if (!item || typeof item !== 'object' || !('id' in item) || typeof item.id !== 'string' || !item.id ||
        !('name' in item) || typeof item.name !== 'string' || !item.name.trim() ||
        !('parentId' in item) || item.parentId !== null && typeof item.parentId !== 'string') throw new Error('folders-invalid');
    return { id: item.id, name: item.name, parentId: item.parentId as string | null };
  });
  const ids = new Set(folders.map((folder) => folder.id));
  if (ids.size !== folders.length) throw new Error('folders-invalid');
  const children = new Map<string | null, typeof folders>();
  for (const folder of folders) {
    const parent = folder.parentId && ids.has(folder.parentId) ? folder.parentId : null;
    const group = children.get(parent) ?? []; group.push(folder); children.set(parent, group);
  }
  const collections: LibraryCollection[] = [];
  const stack = (children.get(null) ?? []).map((folder) => ({ folder, depth: 0, path: folder.name })).reverse();
  while (stack.length) {
    const { folder, depth, path } = stack.pop()!;
    collections.push({ id: folder.id, name: folder.name, source: 'app', depth, path });
    for (const child of [...children.get(folder.id) ?? []].reverse()) stack.push({ folder: child, depth: depth + 1, path: path + ' / ' + child.name });
  }
  if (collections.length !== folders.length) throw new Error('folders-invalid');
  return { revision: Number(data.revision), collections };
}
