import type { RefObject } from 'react';
import { AccountDevicesSetting } from './AccountDevicesSetting';
import { ThemeColorSetting } from './ThemeColorSetting';
import './settings-page.css';

export function SettingsPage({ onSignedOut, anchorRef }: { onSignedOut: () => void; anchorRef?: RefObject<HTMLElement | null>; }) {
  return <section className="settings-page" aria-label="设置">
    <header className="settings-page__header"><h1>设置</h1></header>
    <section className="settings-section" aria-labelledby="settings-appearance-title">
      <h2 id="settings-appearance-title" className="settings-section__title">外观</h2>
      <div className="settings-row"><span className="settings-row__label">主题色</span><ThemeColorSetting /></div>
    </section>
    <AccountDevicesSetting onSignedOut={onSignedOut} anchorRef={anchorRef} />
  </section>;
}
