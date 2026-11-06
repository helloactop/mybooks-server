import { Select } from '../Select/Select';
import type { SelectProps } from '../Select/Select';
import './filter-select.css';

export interface FilterSelectProps extends Omit<SelectProps,
  'size' | 'material' | 'intensity' | 'required' | 'placeholder' | 'matchTriggerWidth' | 'popoverAlign' | 'animation' | 'showChevron' | 'showPlaceholderOption' | 'value' | 'defaultValue' | 'onValueChange'> {
  value: string;
  onValueChange: (value: string) => void;
  /** 提供此文案时，在菜单中显示清除筛选的空选项。 */
  emptyOptionLabel?: string;
}

/** 紧凑筛选入口：固定宽度省略、菜单自适应、液态玻璃与共享形变。 */
export function FilterSelect({ label, value, triggerLabel, emptyOptionLabel, className, ...props }: FilterSelectProps) {
  return <Select {...props} label={label} value={value} className={['ui-filter-select', className].filter(Boolean).join(' ')}
    size="sm" material="liquid" intensity="subtle" required={!emptyOptionLabel} placeholder={emptyOptionLabel ?? label}
    triggerLabel={triggerLabel ?? (!value ? label : undefined)} matchTriggerWidth={false} popoverAlign="end"
    animation="morph" showChevron={false} showPlaceholderOption={!!emptyOptionLabel} />;
}
