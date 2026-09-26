import { useSyncExternalStore } from 'react';

export const THEMES = [
  { id: 'harbor', name: 'Harbor', hint: 'Chart paper by day, deep water at night. Follows your device.' },
  { id: 'desert', name: 'Desert', hint: 'Dune sand, sandstone and red rock.' },
  { id: 'beach', name: 'Beach', hint: 'Sea foam, deep water and coral.' },
  { id: 'forest', name: 'Deep forest', hint: 'Moss green and pine shade, with a firefly glow.' },
  { id: 'prairie', name: 'Prairie', hint: 'Pale wheat under a bluebonnet sky.' },
  { id: 'night', name: 'Night', hint: 'Moonlit dark, with geese crossing the moon.' },
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
  applyPanel(panel);
  window.addEventListener('storage', (e) => {
    if (e.key === KEY) {
      current = savedTheme();
      applyTheme(current);
    } else if (e.key === SCENERY_KEY) {
      scenery = savedScenery();
    } else if (e.key === PANEL_KEY) {
      panel = savedPanel();
      applyPanel(panel);
    } else return;
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

// The picture along the bottom of the screen (see Scenery.tsx). On unless turned off, per device.
const SCENERY_KEY = 'helm.scenery';

function savedScenery(): boolean {
  try {
    return localStorage.getItem(SCENERY_KEY) !== 'off';
  } catch {
    return true;
  }
}

let scenery = savedScenery();

export function setScenery(on: boolean) {
  try {
    localStorage.setItem(SCENERY_KEY, on ? 'on' : 'off');
  } catch {
    // Storage blocked: applies until the page reloads.
  }
  scenery = on;
  for (const l of listeners) l();
}

export function useScenery(): boolean {
  return useSyncExternalStore(subscribe, () => scenery);
}

// How strongly board panels stand out from the page (0-100), per device. Applied as --panel (0-1).
const PANEL_KEY = 'helm.panels';
export const PANEL_DEFAULT = 50;

function savedPanel(): number {
  try {
    const v = Number(localStorage.getItem(PANEL_KEY));
    return localStorage.getItem(PANEL_KEY) !== null && v >= 0 && v <= 100 ? v : PANEL_DEFAULT;
  } catch {
    return PANEL_DEFAULT;
  }
}

let panel = savedPanel();

function applyPanel(v: number) {
  document.documentElement.style.setProperty('--panel', String(v / 100));
}

export function setPanel(v: number) {
  try {
    localStorage.setItem(PANEL_KEY, String(v));
  } catch {
    // Storage blocked: applies until the page reloads.
  }
  panel = v;
  applyPanel(v);
  for (const l of listeners) l();
}

export function usePanel(): number {
  return useSyncExternalStore(subscribe, () => panel);
}
