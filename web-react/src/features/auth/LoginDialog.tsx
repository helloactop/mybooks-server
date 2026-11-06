import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { ContentDialog } from '../../design-system/components/ContentDialog/ContentDialog';
import { TextField } from '../../design-system/components/TextField/TextField';
import { Button } from '../../design-system/components/Button/Button';
import { authRequest, signIn } from './auth-service';
import type { LoginCredentials } from './auth-service';
import './login-dialog.css';

export interface LoginDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
  onAfterClose?: () => void;
  anchorRef?: RefObject<HTMLElement | null>;
  submit?: (credentials: LoginCredentials, signal?: AbortSignal) => Promise<void>;
}

export function LoginDialog({ open, onOpenChange, onSuccess, onAfterClose, anchorRef, submit = signIn }: LoginDialogProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<'checking' | 'ready' | 'uninitialized' | 'error'>('checking');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const action = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!open) { action.current?.abort(); setPassword(''); setBusy(false); return; }
    const controller = new AbortController();
    setStatus('checking'); setError('');
    void authRequest('status', { signal: controller.signal }).then((data) => {
      if (controller.signal.aborted) return;
      if (!data || typeof data !== 'object' || !('initialized' in data)) throw new Error('无法读取服务器状态');
      setStatus(data.initialized ? 'ready' : 'uninitialized');
    }).catch((err: unknown) => { if (!controller.signal.aborted) { setStatus('error'); setError(err instanceof Error ? err.message : '无法连接服务器'); } });
    return () => { controller.abort(); action.current?.abort(); };
  }, [open, attempt]);
  const disabled = status !== 'ready' || busy;
  return <ContentDialog open={open} onOpenChange={onOpenChange} onAfterClose={onAfterClose} title="登录" closeLabel="关闭登录"
    anchorRef={anchorRef} className="login-dialog" size="sm">
    <form className="login-dialog__form" onSubmit={async (event) => {
      event.preventDefault(); if (disabled) return;
      action.current?.abort(); const controller = new AbortController(); action.current = controller;
      setBusy(true); setError('');
      try {
        await submit({ username: username.trim(), password }, controller.signal);
        if (!controller.signal.aborted) { setPassword(''); onSuccess(); }
      } catch (err) { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : '登录失败，请稍后重试'); }
      finally { if (!controller.signal.aborted) setBusy(false); }
    }}>
      <TextField label="用户名" name="username" autoComplete="username" maxLength={80} required material="solid" disabled={disabled} value={username} onChange={(e) => setUsername(e.currentTarget.value)} />
      <TextField label="密码" name="password" type="password" autoComplete="current-password" maxLength={1024} required material="solid" disabled={disabled} value={password} onChange={(e) => setPassword(e.currentTarget.value)} />
      {status === 'checking' && <p role="status">正在连接服务器…</p>}
      {status === 'uninitialized' && <p role="status">服务器尚未初始化，请在服务器终端运行 npm run setup 设置账号。</p>}
      {error && <p role="alert" className="login-dialog__error">{error}</p>}
      {status === 'error' && <Button material="solid" variant="ghost" onClick={() => setAttempt((value) => value + 1)}>重新连接</Button>}
      <Button type="submit" material="solid" fullWidth disabled={status !== 'ready'} loading={busy} loadingLabel="正在登录…">登录</Button>
    </form>
  </ContentDialog>;
}
