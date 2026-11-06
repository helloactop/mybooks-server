import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './design-system';
import { initThemeColor } from './features/settings/theme';

initThemeColor();

createRoot(document.getElementById('root')!).render(
  <StrictMode><App /></StrictMode>,
);
