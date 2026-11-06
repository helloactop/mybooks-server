import { useRef, useState } from 'react';
import MainLayout from '../../layouts/MainLayout';
import { Button } from '../../design-system/components/Button/Button';
import { LoginDialog } from './LoginDialog';

export default function LoginDialogPreview() {
  const [open, setOpen] = useState(true);
  const anchor = useRef<HTMLElement>(null);
  return <MainLayout><section ref={anchor} style={{ minHeight: '100dvh', padding: 24, boxSizing: 'border-box' }}><h1>登录弹窗预览</h1>
    <Button onClick={() => setOpen(true)}>打开登录弹窗</Button>
    <LoginDialog open={open} onOpenChange={setOpen} anchorRef={anchor} onSuccess={() => setOpen(false)}
      submit={async () => { throw new Error('这是样式预览，请从新版首页登录。'); }} /></section></MainLayout>;
}
