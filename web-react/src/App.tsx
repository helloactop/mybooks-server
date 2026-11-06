import { lazy, Suspense, useEffect } from 'react';
import { legacySidebarHref } from './features/library/library-navigation';

const LibraryWorkspace = lazy(() => import('./features/library/LibraryWorkspace'));
const LoginPreview = import.meta.env.DEV ? lazy(() => import('./features/auth/LoginDialog.preview')) : null;
const LibraryPreview = import.meta.env.DEV
  ? lazy(() => import('./features/library/Library.preview'))
  : null;

const GlassPreview = import.meta.env.DEV
  ? lazy(() => import('./design-system/glass/GlassSurface.preview'))
  : null;
const ButtonPreview = import.meta.env.DEV
  ? lazy(() => import('./design-system/components/Button/Button.preview'))
  : null;
const IconButtonPreview = import.meta.env.DEV
  ? lazy(() => import('./design-system/components/IconButton/IconButton.preview'))
  : null;
const TextFieldPreview = import.meta.env.DEV
  ? lazy(() => import('./design-system/components/TextField/TextField.preview'))
  : null;
const SegmentedControlPreview = import.meta.env.DEV
  ? lazy(() => import('./design-system/components/SegmentedControl/SegmentedControl.preview'))
  : null;
const GlassDialogPreview = import.meta.env.DEV
  ? lazy(() => import('./design-system/components/GlassDialog/GlassDialog.preview'))
  : null;
const GlassPopoverPreview = import.meta.env.DEV
  ? lazy(() => import('./design-system/components/GlassPopover/GlassPopover.preview'))
  : null;
const CheckboxPreview = import.meta.env.DEV
  ? lazy(() => import('./design-system/components/Checkbox/Checkbox.preview'))
  : null;
const SwitchPreview = import.meta.env.DEV
  ? lazy(() => import('./design-system/components/Switch/Switch.preview'))
  : null;
const RadioGroupPreview = import.meta.env.DEV
  ? lazy(() => import('./design-system/components/RadioGroup/RadioGroup.preview'))
  : null;
const SelectPreview = import.meta.env.DEV
  ? lazy(() => import('./design-system/components/Select/Select.preview'))
  : null;

const TextAreaPreview = import.meta.env.DEV
  ? lazy(() => import('./design-system/components/TextArea/TextArea.preview'))
  : null;

const ToastPreview = import.meta.env.DEV
  ? lazy(() => import('./design-system/components/Toast/Toast.preview'))
  : null;

const TooltipPreview = import.meta.env.DEV
  ? lazy(() => import('./design-system/components/Tooltip/Tooltip.preview'))
  : null;

const DropdownMenuPreview = import.meta.env.DEV
  ? lazy(() => import('./design-system/components/DropdownMenu/DropdownMenu.preview'))
  : null;
const BadgePreview = import.meta.env.DEV
  ? lazy(() => import('./design-system/components/Badge/Badge.preview'))
  : null;

export default function App() {
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  const canonical = legacySidebarHref(path, window.location.search);
  useEffect(() => { if (canonical) window.location.replace(canonical); }, [canonical]);
  if (canonical) return null;
  const under = (base: string) => path === base || path.startsWith(base + '/');
  if (LoginPreview && path === '/mybooks/playground/login') {
    return <Suspense fallback={null}><LoginPreview /></Suspense>;
  }
  if (LibraryPreview && under('/mybooks/playground/library')) {
    return <Suspense fallback={null}><LibraryPreview /></Suspense>;
  }
  if (LibraryPreview && under('/mybooks/playground/guest')) {
    return <Suspense fallback={null}><LibraryPreview guest /></Suspense>;
  }
  if (GlassPreview && window.location.pathname.replace(/\/+$/, '') === '/mybooks/playground/glass') {
    return <Suspense fallback={null}><GlassPreview /></Suspense>;
  }
  if (ButtonPreview && window.location.pathname.replace(/\/+$/, '') === '/mybooks/playground/button') {
    return <Suspense fallback={null}><ButtonPreview /></Suspense>;
  }
  if (IconButtonPreview && window.location.pathname.replace(/\/+$/, '') === '/mybooks/playground/icon-button') {
    return <Suspense fallback={null}><IconButtonPreview /></Suspense>;
  }
  if (TextFieldPreview && window.location.pathname.replace(/\/+$/, '') === '/mybooks/playground/text-field') {
    return <Suspense fallback={null}><TextFieldPreview /></Suspense>;
  }
  if (SegmentedControlPreview && window.location.pathname.replace(/\/+$/, '') === '/mybooks/playground/segmented-control') {
    return <Suspense fallback={null}><SegmentedControlPreview /></Suspense>;
  }
  if (GlassDialogPreview && window.location.pathname.replace(/\/+$/, '') === '/mybooks/playground/glass-dialog') {
    return <Suspense fallback={null}><GlassDialogPreview /></Suspense>;
  }
  if (GlassPopoverPreview && window.location.pathname.replace(/\/+$/, '') === '/mybooks/playground/glass-popover') {
    return <Suspense fallback={null}><GlassPopoverPreview /></Suspense>;
  }
  if (CheckboxPreview && window.location.pathname.replace(/\/+$/, '') === '/mybooks/playground/checkbox') {
    return <Suspense fallback={null}><CheckboxPreview /></Suspense>;
  }
  if (SwitchPreview && window.location.pathname.replace(/\/+$/, '') === '/mybooks/playground/switch') {
    return <Suspense fallback={null}><SwitchPreview /></Suspense>;
  }
  if (RadioGroupPreview && window.location.pathname.replace(/\/+$/, '') === '/mybooks/playground/radio-group') {
    return <Suspense fallback={null}><RadioGroupPreview /></Suspense>;
  }
  if (SelectPreview && window.location.pathname.replace(/\/+$/, '') === '/mybooks/playground/select') {
    return <Suspense fallback={null}><SelectPreview /></Suspense>;
  }
  if (TextAreaPreview && window.location.pathname.replace(/\/+$/, '') === '/mybooks/playground/text-area') {
    return <Suspense fallback={null}><TextAreaPreview /></Suspense>;
  }
  if (ToastPreview && window.location.pathname.replace(/\/+$/, '') === '/mybooks/playground/toast') {
    return <Suspense fallback={null}><ToastPreview /></Suspense>;
  }
  if (TooltipPreview && window.location.pathname.replace(/\/+$/, '') === '/mybooks/playground/tooltip') {
    return <Suspense fallback={null}><TooltipPreview /></Suspense>;
  }
  if (DropdownMenuPreview && window.location.pathname.replace(/\/+$/, '') === '/mybooks/playground/dropdown-menu') {
    return <Suspense fallback={null}><DropdownMenuPreview /></Suspense>;
  }
  if (BadgePreview && window.location.pathname.replace(/\/+$/, '') === '/mybooks/playground/badge') {
    return <Suspense fallback={null}><BadgePreview /></Suspense>;
  }
  return <Suspense fallback={null}><LibraryWorkspace /></Suspense>;
}
