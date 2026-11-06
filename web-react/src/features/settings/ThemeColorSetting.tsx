import { useState } from 'react';
import { Check } from 'lucide-react';
import { ColorPickerDialog } from '../../design-system/components/ColorPicker/ColorPickerDialog';
import { applyThemeColor, readThemeColor, storeThemeColor, themeTextColor, DEFAULT_THEME_COLOR, THEME_PRESETS } from './theme';
import './theme-color-setting.css';

export function ThemeColorSetting() {
  const [value, setValue] = useState(readThemeColor);
  const [pickerOpen, setPickerOpen] = useState(false);
  const preset = THEME_PRESETS.find((item) => item.value === value);
  const choose = (next: string) => {
    setValue(applyThemeColor(next));
    storeThemeColor(next);
  };
  return <div className="theme-color-setting">
    <div className="theme-color-setting__colors" role="group" aria-label="主题色">
      {THEME_PRESETS.map((item) => <button key={item.value} type="button" className="theme-color-setting__swatch"
        style={{ background: item.value }} aria-label={item.name} aria-pressed={value === item.value} title={item.name}
        onClick={() => choose(item.value)}>
        {value === item.value && <Check aria-hidden="true" focusable="false" style={{ color: themeTextColor(item.value) }} />}
      </button>)}
      <button type="button" className="theme-color-setting__custom" title="自定义主题色" aria-label="自定义主题色"
        data-active={preset === undefined} onClick={() => setPickerOpen(true)}><span aria-hidden="true" /></button>
    </div>
    <span className="theme-color-setting__value" aria-live="polite">{preset?.name ?? value.toUpperCase()}</span>
    <ColorPickerDialog open={pickerOpen} onOpenChange={setPickerOpen} value={value}
      resetValue={DEFAULT_THEME_COLOR} onConfirm={choose} />
  </div>;
}
