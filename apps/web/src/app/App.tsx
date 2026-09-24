import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { BoardView } from '../features/board/BoardView.tsx';
import { DoneView } from '../features/done/DoneView.tsx';
import { FocusView } from '../features/focus/FocusView.tsx';
import { EditorProvider, useEditor } from '../features/task-editor/EditorContext.tsx';
import { api } from '../lib/api.ts';
import { hrefFor, useRoute, type Route } from '../lib/route.ts';
import { useLiveSync, type SyncState } from '../lib/sync.ts';
import { ToastProvider } from '../ui/Toast.tsx';
import { Login } from './Login.tsx';
import './app.css';

const SYNC_LABEL: Record<SyncState, string> = {
  connecting: 'Connecting',
  live: 'Live',
  offline: 'Offline',
};

const NAV: { route: Route; label: string; key: string }[] = [
  { route: 'focus', label: 'Focus', key: 'f' },
  { route: 'board', label: 'Board', key: 'b' },
  { route: 'done', label: 'Done', key: 'd' },
];

function isTyping(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}

export function App() {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });
  const signedIn = me.data?.signedIn === true;
  const sync = useLiveSync(signedIn);

  if (me.isPending) return null;
  if (!signedIn) return <Login onSignedIn={() => qc.invalidateQueries({ queryKey: ['me'] })} />;

  return (
    <ToastProvider>
      <EditorProvider>
        <Shell sync={sync} />
      </EditorProvider>
    </ToastProvider>
  );
}

function Shell({ sync }: { sync: SyncState }) {
  const editor = useEditor();
  const route = useRoute();

  // Single-key shortcuts: N new task, F focus, B board, D done (not while typing or in a dialog).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
      if (document.querySelector('dialog[open]')) return;
      if (e.key === 'n') {
        e.preventDefault();
        editor.openCreate();
        return;
      }
      const nav = NAV.find((n) => n.key === e.key);
      if (nav) window.location.hash = hrefFor(nav.route);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editor]);

  return (
    <div className={`shell shell-${route}`}>
      <header className="topbar">
        <span className="wordmark">Helm</span>
        <nav className="nav" aria-label="Views">
          {NAV.map((n) => (
            <a
              key={n.route}
              href={hrefFor(n.route)}
              aria-current={route === n.route ? 'page' : undefined}
              aria-keyshortcuts={n.key}
            >
              {n.label}
            </a>
          ))}
        </nav>
        <div className="topbar-end">
          <span className={`sync sync-${sync}`} role="status">
            {SYNC_LABEL[sync]}
          </span>
          <button className="btn topbar-add" onClick={() => editor.openCreate()} aria-keyshortcuts="n">
            <span className="topbar-add-plus" aria-hidden>
              +
            </span>
            <span className="topbar-add-label">Add task</span>
          </button>
        </div>
      </header>
      {route === 'board' ? <BoardView /> : route === 'done' ? <DoneView /> : <FocusView />}
    </div>
  );
}
