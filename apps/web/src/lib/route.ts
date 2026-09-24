import { useEffect, useState } from 'react';

export type Route = 'focus' | 'board';

const ROUTES: Record<string, Route> = { '': 'focus', '#/': 'focus', '#/board': 'board' };

export const hrefFor = (r: Route) => (r === 'focus' ? '#/' : `#/${r}`);

function current(): Route {
  return ROUTES[window.location.hash] ?? 'focus';
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
