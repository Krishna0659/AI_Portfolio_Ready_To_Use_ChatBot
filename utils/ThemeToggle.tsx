'use client';
import { useEffect, useState } from 'react';
import './public-theme.css';

export type ThemePreference = 'light' | 'dark' | 'system';
const storageKey = 'portfolioai-theme';
export const themeChangeEvent = 'portfolioai-theme-change';
let memoryPreference: ThemePreference | null = null;
const validTheme = (value: string | null): value is ThemePreference => value === 'light' || value === 'dark' || value === 'system';

export function readThemePreference(): ThemePreference | null {
  if (memoryPreference) return memoryPreference;
  try {
    const saved = localStorage.getItem(storageKey) ?? localStorage.getItem('portfolioai-public-theme');
    if (validTheme(saved)) return saved;
  } catch {}
  return memoryPreference;
}

function applyTheme(preference: ThemePreference) {
  const resolved = preference === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : preference;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.publicTheme = resolved;
  return resolved;
}

export function setThemePreference(preference: ThemePreference) {
  memoryPreference = preference;
  try { localStorage.setItem(storageKey, preference); localStorage.removeItem('portfolioai-public-theme'); } catch {}
  applyTheme(preference);
  window.dispatchEvent(new Event(themeChangeEvent));
}

export default function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const query = matchMedia('(prefers-color-scheme: dark)');
    const sync = () => setDark(applyTheme(readThemePreference() ?? 'system') === 'dark');
    const storage = (event: StorageEvent) => {
      if (event.key === storageKey || event.key === 'portfolioai-public-theme' || event.key === null) {
        memoryPreference = null;
        sync();
        window.dispatchEvent(new Event(themeChangeEvent));
      }
    };
    sync();
    query.addEventListener('change', sync);
    window.addEventListener(themeChangeEvent, sync);
    window.addEventListener('storage', storage);
    return () => {
      query.removeEventListener('change', sync);
      window.removeEventListener(themeChangeEvent, sync);
      window.removeEventListener('storage', storage);
    };
  }, []);
  return <button className="public-theme-toggle" type="button" aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'} aria-pressed={dark} onClick={() => setThemePreference(dark ? 'light' : 'dark')}>{dark ? 'Light mode' : 'Dark mode'}</button>;
}
