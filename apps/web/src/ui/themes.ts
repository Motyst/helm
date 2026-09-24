import { useSyncExternalStore } from 'react';

export const THEMES = [
  { id: 'harbor', name: 'Harbor', hint: 'Chart paper by day, deep water at night. Follows your device.' },
  { id: 'desert', name: 'Desert', hint: 'Dune sand, sandstone and red rock.' },
  { id: 'beach', name: 'Beach', hint: 'Sea foam, deep water and coral.' },
  { id: 'forest', name: 'Deep forest', hint: 'Dark pine and moss, with a firefly glow.' },
  { id: 'prairie', name: 'Prairie', hint: 'Pale wheat under a bluebonnet sky.' },
  { id: 'night', name: 'Night', hint: 'Plain dark with a moonlight accent.' },
] as const;

export type ThemeId = (typeof THEMES)[number]['id'];

/** Per device, so a wall display and a phone can differ. index.html reads the same key before first paint. */
const KEY = 'helm.theme';
const DEFAULT: ThemeId = 'harbor';

const isTheme = (v: unknown): v is ThemeId => THEMES.some((t) => t.id === v);

export function savedTheme(): ThemeId {
  try {
    const v = localStorage.getItem(KEY);
    return isTheme(v) ? v : DEFAULT;
  } catch {
    return DEFAULT;
  }
}

/** Puts the theme on the page and tints the phone's status bar to match. */
export function applyTheme(id: ThemeId) {
  const root = document.documentElement;
  root.dataset.theme = id;
  const water = getComputedStyle(root).getPropertyValue('--water').trim();
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    // Harbor keeps index.html's light and dark colors; the others have one color for both.
    meta.dataset.harbor ??= meta.content;
    meta.content = id === 'harbor' ? meta.dataset.harbor : water;
  }
}

const listeners = new Set<() => void>();

export function setTheme(id: ThemeId) {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    // Storage blocked: the theme still applies until the page reloads.
  }
  current = id;
  applyTheme(id);
  for (const l of listeners) l();
}

let current = savedTheme();

/** Call once at startup: syncs the status bar color and follows theme changes made in other windows. */
export function startThemes() {
  applyTheme(current);
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY) return;
    current = savedTheme();
    applyTheme(current);
    for (const l of listeners) l();
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export function useTheme(): ThemeId {
  return useSyncExternalStore(subscribe, () => current);
}
