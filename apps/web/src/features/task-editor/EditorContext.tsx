import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { Priority, TaskSuggestion, VoiceParseResult } from '@helm/shared';
import { TaskDialog } from './TaskDialog.tsx';

/** Where a draft came from when it wasn't typed: shown in the dialog, saved as source `voice`. */
export interface VoiceOrigin {
  transcript: string;
  suggestion: TaskSuggestion;
  /** 1-based position among the drafts from one recording. */
  index: number;
  total: number;
  /** Why the details weren't filled in, when parsing failed. */
  notice?: string;
  parsed: boolean;
}

export interface CreateDefaults {
  projectId?: string | null;
  priority?: Priority;
  parentTaskId?: string;
  voice?: VoiceOrigin;
}

export type EditorTarget = { mode: 'create'; defaults: CreateDefaults } | { mode: 'edit'; taskId: string };

interface EditorApi {
  openCreate: (defaults?: CreateDefaults) => void;
  openEdit: (taskId: string) => void;
  /** Review voice drafts one after another. */
  openSuggestions: (result: VoiceParseResult) => void;
}

const EditorCtx = createContext<EditorApi | null>(null);

export function EditorProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<EditorTarget | null>(null);
  // Drafts waiting after the one on screen.
  const [queue, setQueue] = useState<EditorTarget[]>([]);
  // Bumped on every open so the dialog remounts with fresh state.
  const [openCount, setOpenCount] = useState(0);

  const show = useCallback((t: EditorTarget | null, rest: EditorTarget[] = []) => {
    setTarget(t);
    setQueue(rest);
    setOpenCount((n) => n + 1);
  }, []);

  const openCreate = useCallback((defaults: CreateDefaults = {}) => show({ mode: 'create', defaults }), [show]);
  const openEdit = useCallback((taskId: string) => show({ mode: 'edit', taskId }), [show]);
  const openSuggestions = useCallback(
    (r: VoiceParseResult) => {
      const drafts: EditorTarget[] = r.tasks.map((suggestion, i) => ({
        mode: 'create',
        defaults: {
          voice: {
            transcript: r.transcript,
            suggestion,
            index: i + 1,
            total: r.tasks.length,
            notice: r.notice,
            parsed: r.parsed,
          },
        },
      }));
      show(drafts[0] ?? null, drafts.slice(1));
    },
    [show],
  );
  const api = useMemo(() => ({ openCreate, openEdit, openSuggestions }), [openCreate, openEdit, openSuggestions]);

  // `next`: saved or skipped, so move on to the next queued draft. Otherwise close everything.
  const onClose = (next: boolean) => {
    if (next && queue.length) show(queue[0]!, queue.slice(1));
    else show(null);
  };

  return (
    <EditorCtx.Provider value={api}>
      {children}
      {target && <TaskDialog key={openCount} target={target} queued={queue.length} onClose={onClose} />}
    </EditorCtx.Provider>
  );
}

export function useEditor(): EditorApi {
  const ctx = useContext(EditorCtx);
  if (!ctx) throw new Error('useEditor must be used inside EditorProvider');
  return ctx;
}
