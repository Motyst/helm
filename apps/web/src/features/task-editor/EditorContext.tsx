import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { Priority } from '@helm/shared';
import { TaskDialog } from './TaskDialog.tsx';

export interface CreateDefaults {
  projectId?: string | null;
  priority?: Priority;
  parentTaskId?: string;
}

export type EditorTarget = { mode: 'create'; defaults: CreateDefaults } | { mode: 'edit'; taskId: string };

interface EditorApi {
  openCreate: (defaults?: CreateDefaults) => void;
  openEdit: (taskId: string) => void;
}

const EditorCtx = createContext<EditorApi | null>(null);

export function EditorProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<EditorTarget | null>(null);
  // Bumped on every open so the dialog remounts with fresh state.
  const [openCount, setOpenCount] = useState(0);

  const openCreate = useCallback((defaults: CreateDefaults = {}) => {
    setTarget({ mode: 'create', defaults });
    setOpenCount((n) => n + 1);
  }, []);
  const openEdit = useCallback((taskId: string) => {
    setTarget({ mode: 'edit', taskId });
    setOpenCount((n) => n + 1);
  }, []);
  const api = useMemo(() => ({ openCreate, openEdit }), [openCreate, openEdit]);

  return (
    <EditorCtx.Provider value={api}>
      {children}
      {target && <TaskDialog key={openCount} target={target} onClose={() => setTarget(null)} />}
    </EditorCtx.Provider>
  );
}

export function useEditor(): EditorApi {
  const ctx = useContext(EditorCtx);
  if (!ctx) throw new Error('useEditor must be used inside EditorProvider');
  return ctx;
}
