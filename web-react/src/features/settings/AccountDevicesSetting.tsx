import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { LogOut, Monitor, RefreshCw } from 'lucide-react';
import { Button } from '../../design-system/components/Button/Button';
import { Badge } from '../../design-system/components/Badge/Badge';
import { ContentDialog } from '../../design-system/components/ContentDialog/ContentDialog';
import { isSessionExpired, loadAccountDevices, revokeDevice, signOut } from './account-devices';
import type { AccountDevices, AuthorizedDevice } from './account-devices';
import './account-devices-setting.css';

interface AccountDevicesSettingProps {
  onSignedOut: () => void;
  anchorRef?: RefObject<HTMLElement | null>;
}
type Confirmation = { kind: 'logout' } | { kind: 'revoke'; device: AuthorizedDevice };

export function AccountDevicesSetting({ onSignedOut, anchorRef }: AccountDevicesSettingProps) {
  const [account, setAccount] = useState<AccountDevices | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadError, setLoadError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [message, setMessage] = useState('');
  const action = useRef<AbortController | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const failure = (error: unknown) => {
    if (isSessionExpired(error)) {
      window.dispatchEvent(new CustomEvent('mybooks:login-required', { cancelable: true }));
      return '登录已失效，请重新登录';
    }
    return error instanceof Error ? error.message : '操作失败，请稍后重试';
  };
  useEffect(() => {
    const controller = new AbortController();
    setStatus('loading'); setLoadError('');
    void loadAccountDevices(controller.signal).then((data) => {
      if (!controller.signal.aborted) { setAccount(data); setStatus('ready'); }
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) { setLoadError(failure(error)); setStatus('error'); }
    });
    return () => controller.abort();
  }, [attempt]);
  useEffect(() => () => action.current?.abort(), []);

  const ask = (next: Confirmation) => { setConfirmation(next); setActionError(''); setMessage(''); setConfirmOpen(true); };
  const confirm = async () => {
    if (!confirmation || action.current || (confirmation.kind === 'revoke' && !account)) return;
    const controller = new AbortController(); action.current = controller;
    setBusy(true); setActionError('');
    try {
      if (confirmation.kind === 'logout') {
        await signOut(controller.signal);
        if (!controller.signal.aborted) onSignedOut();
      } else {
        await revokeDevice(confirmation.device.id, account!.currentId, controller.signal);
        if (!controller.signal.aborted) {
          setAccount((current) => current && { ...current, devices: current.devices.filter((device) => device.id !== confirmation.device.id) });
          setMessage(`已撤销“${confirmation.device.label || '未命名设备'}”的授权`);
          setConfirmOpen(false);
        }
      }
    } catch (error) { if (!controller.signal.aborted) setActionError(failure(error)); }
    finally { if (!controller.signal.aborted) { action.current = null; setBusy(false); } }
  };
  const loggingOut = confirmation?.kind === 'logout';
  return <section className="settings-section account-devices-setting" aria-labelledby="settings-account-title">
    <div className="account-devices-setting__heading">
      <div><h2 id="settings-account-title" className="settings-section__title">账号与设备</h2>
        <p className="account-devices-setting__description">查看已授权设备，管理登录权限。</p></div>
      <Button variant="ghost" material="solid" startIcon={LogOut} onClick={() => ask({ kind: 'logout' })}>退出登录</Button>
    </div>
    <div className="account-devices-setting__list-heading"><h3>已授权设备{status === 'ready' && account ? `（${account.devices.length}）` : ''}</h3>
      <Button variant="ghost" material="solid" size="sm" startIcon={RefreshCw} disabled={status === 'loading' || busy}
        onClick={() => { setMessage(''); setAttempt((value) => value + 1); }}>刷新</Button></div>
    {status === 'loading' && <p className="account-devices-setting__description" role="status">正在加载设备…</p>}
    {status === 'error' && <div><p className="account-devices-setting__error" role="alert">{loadError}</p>
      <Button variant="secondary" material="solid" size="sm" onClick={() => setAttempt((value) => value + 1)}>重试</Button></div>}
    {status === 'ready' && account && <ul className="account-devices-setting__list">{account.devices.map((device) => {
      const current = device.id === account.currentId;
      return <li key={device.id} className="account-devices-setting__device">
        <Monitor className="account-devices-setting__icon" aria-hidden="true" focusable="false" />
        <div className="account-devices-setting__device-info"><div className="account-devices-setting__device-name"><strong>{device.label || '未命名设备'}</strong>
          {current && <Badge size="sm">当前设备</Badge>}</div>
          <p className="account-devices-setting__description">登录于 <time dateTime={device.createdAt}>{new Date(device.createdAt).toLocaleString('zh-CN', { hour12: false })}</time></p></div>
        {!current && <Button variant="ghost" material="solid" size="sm" disabled={busy} aria-label={`撤销 ${device.label || '未命名设备'} 的授权`}
          onClick={() => ask({ kind: 'revoke', device })}>撤销授权</Button>}
      </li>;
    })}</ul>}
    {status === 'ready' && account?.devices.length === 0 && <p className="account-devices-setting__description">暂无已授权设备</p>}
    <p className="account-devices-setting__message" role="status">{message}</p>
    <ContentDialog open={confirmOpen} onOpenChange={(open) => { if (!busy) setConfirmOpen(open); }} anchorRef={anchorRef} size="sm"
      title={loggingOut ? '退出当前设备？' : '撤销设备授权？'} closeLabel="关闭确认" initialFocusRef={cancelRef}
      closeOnEscape={!busy} closeOnBackdrop={!busy} showCloseButton={!busy}
      footer={<><Button ref={cancelRef} variant="secondary" material="solid" disabled={busy} onClick={() => setConfirmOpen(false)}>取消</Button>
        <Button variant="danger" material="solid" loading={busy} loadingLabel={loggingOut ? '正在退出…' : '正在撤销…'} onClick={() => void confirm()}>
          {loggingOut ? '退出登录' : '撤销授权'}</Button></>}>
      <p className="account-devices-setting__confirmation">{loggingOut ? '退出后，此设备需要重新登录才能管理书库。其他设备不受影响。'
        : `撤销“${confirmation?.kind === 'revoke' ? confirmation.device.label || '未命名设备' : ''}”的授权后，该设备需要重新登录才能访问书库。`}</p>
      {actionError && <p className="account-devices-setting__error" role="alert">{actionError}</p>}
    </ContentDialog>
  </section>;
}
