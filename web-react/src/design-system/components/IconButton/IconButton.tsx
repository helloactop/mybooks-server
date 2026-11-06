import { forwardRef } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Button } from '../Button/Button';
import type { ButtonProps } from '../Button/Button';
import './icon-button.css';

export interface IconButtonProps extends Omit<ButtonProps,
  'children' | 'startIcon' | 'endIcon' | 'fullWidth' | 'loadingLabel' | 'aria-label'> {
  icon: LucideIcon;
  /** 必须说明操作用途，作为可访问名称和默认原生提示。 */
  label: string;
}

export const IconButton = /* @__PURE__ */ forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton({
  icon: Icon,
  label,
  variant = 'secondary',
  title,
  className,
  ...props
}, ref) {
  const name = typeof label === 'string' ? label.trim() : '';
  if (import.meta.env.DEV && !name) throw new Error('IconButton 的 label 必须提供非空的操作名称。');

  return (
    <Button
      {...props}
      ref={ref}
      variant={variant}
      aria-label={name}
      title={title === undefined ? name : title}
      className={['ui-icon-button', className].filter(Boolean).join(' ')}
    >
      <Icon className="ui-button__icon" aria-hidden="true" focusable="false" />
    </Button>
  );
});
