import { useEffect, useState } from 'react';

export type Route = 'focus' | 'board' | 'done' | 'settings';

const ROUTES: Record<string, Route> = {
  '': 'focus',
  '#/': 'focus',
  '#/board': 'board',
  '#/done': 'done',
  '#/settings': 'settings',
};

export const hrefFor = (r: Route) => (r === 'focus' ? '#/' : `#/${r}`);

function current(): Route {
  return ROUTES[window.location.hash.split('?')[0]!] ?? 'focus';
}

/** View state kept in the hash (`#/done?range=week`), so a filtered view can be bookmarked. */
export function readHashParams(): URLSearchParams {
  return new URLSearchParams(window.location.hash.split('?')[1] ?? '');
}

/** Rewrites the current entry without adding history or firing `hashchange`. */
export function writeHashParams(params: URLSearchParams) {
  const path = window.location.hash.split('?')[0] || '#/';
  const q = params.toString();
  history.replaceState(history.state, '', q ? `${path}?${q}` : path);
}

/** Tiny hash router: the app has a handful of top-level views and no nested routes. */
export function useRoute(): Route {
  const [route, setRoute] = useState(current);
  useEffect(() => {
    const onHash = () => setRoute(current());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  return route;
}
