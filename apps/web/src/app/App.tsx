import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { FocusView } from '../features/focus/FocusView.tsx';
import { EditorProvider, useEditor } from '../features/task-editor/EditorContext.tsx';
import { api } from '../lib/api.ts';
import { useLiveSync, type SyncState } from '../lib/sync.ts';
import { Login } from './Login.tsx';
import './app.css';

const SYNC_LABEL: Record<SyncState, string> = {
  connecting: 'Connecting',
  live: 'Live',
  offline: 'Offline',
};

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
    <EditorProvider>
      <Shell sync={sync} />
    </EditorProvider>
  );
}

function Shell({ sync }: { sync: SyncState }) {
  const editor = useEditor();

  // "N" opens a new task from anywhere (unless typing or a dialog is open).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'n' || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
      if (document.querySelector('dialog[open]')) return;
      e.preventDefault();
      editor.openCreate();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editor]);

  return (
    <div className="shell">
      <header className="topbar">
        <span className="wordmark">Helm</span>
        <div className="topbar-end">
          <span className={`sync sync-${sync}`} role="status">
            {SYNC_LABEL[sync]}
          </span>
          <button className="btn" onClick={() => editor.openCreate()} aria-keyshortcuts="n">
            Add task
          </button>
        </div>
      </header>
      <FocusView />
    </div>
  );
}
