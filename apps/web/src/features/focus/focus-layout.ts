import { useSyncExternalStore } from 'react';

/** How the Focus view is laid out, per device (like the theme). */
export const FOCUS_LAYOUTS = [
  { id: 'one', name: 'One thing', hint: 'Only the task in progress and its next step. Big buttons at the bottom.' },
  { id: 'vital', name: 'Vital three', hint: 'The three tasks that matter most, numbered. The rest is folded away.' },
  { id: 'compass', name: 'Compass', hint: 'A countdown ring, the task and three round buttons. Nothing else.' },
] as const;

export type FocusLayout = (typeof FOCUS_LAYOUTS)[number]['id'];

const KEY = 'helm.focusLayout';
const listeners = new Set<() => void>();

function saved(): FocusLayout {
  try {
    const v = localStorage.getItem(KEY);
    return FOCUS_LAYOUTS.some((l) => l.id === v) ? (v as FocusLayout) : 'one';
  } catch {
    return 'one';
  }
}

let current = saved();

export function setFocusLayout(layout: FocusLayout) {
  try {
    localStorage.setItem(KEY, layout);
  } catch {
    // Storage blocked: applies until the page reloads.
  }
  current = layout;
  for (const l of listeners) l();
}

export function useFocusLayout(): FocusLayout {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}
