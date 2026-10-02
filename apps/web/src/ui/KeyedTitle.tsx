import { Fragment, useSyncExternalStore } from 'react';
import { splitKeyed } from '@helm/shared';

// Key words in bold, for skimming. On unless turned off, per device (like the landscape).
const KEY = 'helm.keyWords';
const listeners = new Set<() => void>();

function saved(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}

let on = saved();

export function setKeyWordsOn(value: boolean) {
  try {
    localStorage.setItem(KEY, value ? 'on' : 'off');
  } catch {
    // Storage blocked: applies until the page reloads.
  }
  on = value;
  for (const l of listeners) l();
}

export function useKeyWordsOn(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => on,
  );
}

/** A task title with its key words in bold. Plain until the server has picked them. */
export function KeyedTitle({ title, words }: { title: string; words?: string[] | null }) {
  const show = useKeyWordsOn();
  if (!show || !words?.length) return <>{title}</>;
  return (
    <>
      {splitKeyed(title, words).map((p, i) =>
        p.key ? (
          <b key={i} className="kw">
            {p.text}
          </b>
        ) : (
          <Fragment key={i}>{p.text}</Fragment>
        ),
      )}
    </>
  );
}
