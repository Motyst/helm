import { hrefFor } from '../../lib/route.ts';

/** Done and Activity are two logs under one tab: finished work, and every change. */
export function LogTabs({ current }: { current: 'done' | 'activity' }) {
  return (
    <nav className="log-tabs" aria-label="Logs">
      <a href={hrefFor('done')} aria-current={current === 'done' ? 'page' : undefined}>
        Finished
      </a>
      <a href={hrefFor('activity')} aria-current={current === 'activity' ? 'page' : undefined}>
        Activity
      </a>
    </nav>
  );
}
