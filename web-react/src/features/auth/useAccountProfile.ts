import { useEffect, useState } from 'react';
import { apiGet } from '../../shared/api';
import { parseAccountProfile } from './account-profile';

export interface SidebarAccountProfile { nickname: string; avatarUrl: string | null; }

export function useAccountProfile(enabled: boolean): SidebarAccountProfile | null {
  const [profile, setProfile] = useState<SidebarAccountProfile | null>(null);
  useEffect(() => {
    setProfile(null);
    if (!enabled) return;
    let request: AbortController | null = null;
    let currentPath: string | null = null;
    let avatarUrl: string | null = null;
    const releaseAvatar = () => { if (avatarUrl) URL.revokeObjectURL(avatarUrl); avatarUrl = null; };
    const refresh = async () => {
      request?.abort();
      const controller = new AbortController(); request = controller;
      const { signal } = controller;
      try {
        const { data } = await apiGet('/api/sync/state', signal);
        if (signal.aborted) return;
        const next = parseAccountProfile(data);
        if (next.avatarPath !== currentPath) { releaseAvatar(); currentPath = next.avatarPath; }
        setProfile({ nickname: next.nickname, avatarUrl });
        if (!next.avatarPath || avatarUrl) return;
        // 同步资源的响应类型是二进制，通过会话读取后转换为图片 Blob；不将私有资源改成公开地址。
        const response = await fetch(next.avatarPath, { signal, credentials: 'same-origin', cache: 'no-store' });
        if (signal.aborted) return;
        if (response.status === 401) {
          window.dispatchEvent(new CustomEvent('mybooks:login-required', { cancelable: true }));
          return;
        }
        if (!response.ok) return;
        const bytes = await response.blob();
        if (signal.aborted || !bytes.size) return;
        avatarUrl = URL.createObjectURL(new Blob([bytes], { type: next.avatarMime }));
        setProfile({ nickname: next.nickname, avatarUrl });
      } catch { /* 网络失败保留已加载资料；下一次回到页面时重试。 */ }
    };
    const foreground = () => { if (!document.hidden) void refresh(); };
    void refresh();
    window.addEventListener('focus', foreground);
    document.addEventListener('visibilitychange', foreground);
    return () => {
      request?.abort(); releaseAvatar();
      window.removeEventListener('focus', foreground);
      document.removeEventListener('visibilitychange', foreground);
    };
  }, [enabled]);
  return enabled ? profile : null;
}
