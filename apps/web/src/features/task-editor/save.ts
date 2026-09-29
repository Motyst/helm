import type { Priority, Task, TaskSource, TaskSuggestion, UpdateTaskInput } from '@helm/shared';
import { api } from '../../lib/api.ts';

export interface SubtaskDraft {
  /** Stable React key. */
  key: string;
  /** Existing subtask id; undefined for new ones. */
  id?: string;
  title: string;
  done: boolean;
}

export interface TaskDraft {
  title: string;
  notes: string;
  projectId: string | null;
  priority: Priority;
  estimateMinutes: number | null;
  subtasks: SubtaskDraft[];
  /** Handed to agents (any hand-off state counts; only ready ↔ none is edited in the form). */
  agentReady: boolean;
}

export function draftFrom(task: Task, subtasks: Task[]): TaskDraft {
  return {
    title: task.title,
    notes: task.notes ?? '',
    projectId: task.projectId,
    priority: task.priority,
    estimateMinutes: task.estimateMinutes,
    subtasks: subtasks.map((s) => ({ key: s.id, id: s.id, title: s.title, done: s.status === 'done' })),
    agentReady: task.agentState !== null,
  };
}

let voiceSeq = 0;

/** A voice suggestion as an editable draft. Unstated priority falls back to Soon, like typed tasks. */
export function draftFromSuggestion(s: TaskSuggestion): TaskDraft {
  return {
    title: s.title,
    notes: s.notes ?? '',
    projectId: s.projectId,
    priority: s.priority ?? 'soon',
    estimateMinutes: s.estimateMinutes,
    subtasks: s.subtasks.map((title) => ({ key: `voice-${++voiceSeq}`, title, done: false })),
    agentReady: false,
  };
}

const cleanNotes = (notes: string) => (notes.trim() ? notes : null);

/** Create a task with its subtasks in one request. Returns the saved parent. */
export function createFromDraft(d: TaskDraft, parentTaskId?: string, source?: TaskSource): Promise<Task> {
  const subtasks = d.subtasks.filter((s) => s.title.trim()).map((s) => ({ title: s.title.trim() }));
  return api.createTask({
    title: d.title,
    notes: cleanNotes(d.notes),
    projectId: d.projectId,
    priority: d.priority,
    estimateMinutes: d.estimateMinutes,
    parentTaskId: parentTaskId ?? null,
    source,
    subtasks: subtasks.length ? subtasks : undefined,
    agentState: d.agentReady ? 'ready' : undefined,
  });
}

/**
 * Notes to save when the user edited them. If an agent added to the notes while the dialog was
 * open, its addition is kept below the user's edit instead of being overwritten.
 */
export function mergeNotes(opened: string | null, live: string | null, edited: string | null): string | null {
  if (live === opened || !live || !opened || !live.startsWith(opened)) return edited;
  const added = live.slice(opened.length).trim();
  return edited ? `${edited.trimEnd()}\n\n${added}` : added;
}

/**
 * Apply an edited draft: one PATCH for the fields the user changed since opening the dialog
 * (so changes made meanwhile by agents or other devices aren't overwritten with stale values),
 * then subtask creates / renames / status changes / deletes. Live events update the cache.
 */
export async function saveDraft(opened: Task, live: Task, originalSubs: Task[], d: TaskDraft): Promise<void> {
  const patch: UpdateTaskInput = {};
  if (d.title !== opened.title) patch.title = d.title;
  if (cleanNotes(d.notes) !== opened.notes) patch.notes = mergeNotes(opened.notes, live.notes, cleanNotes(d.notes));
  if (d.priority !== opened.priority) patch.priority = d.priority;
  if (d.estimateMinutes !== opened.estimateMinutes) patch.estimateMinutes = d.estimateMinutes;
  if (d.projectId !== opened.projectId && !opened.parentTaskId) patch.projectId = d.projectId;
  if (d.agentReady !== (opened.agentState !== null)) patch.agentState = d.agentReady ? 'ready' : null;
  if (Object.keys(patch).length) await api.updateTask(opened.id, patch);

  const kept = new Set<string>();
  for (const s of d.subtasks) {
    const title = s.title.trim();
    if (!s.id) {
      if (!title) continue;
      const created = await api.createTask({ title, parentTaskId: opened.id });
      if (s.done) await api.taskAction(created.id, 'complete');
      continue;
    }
    const orig = originalSubs.find((o) => o.id === s.id);
    if (!orig) continue;
    if (!title) continue; // emptied → treated as removed below
    kept.add(s.id);
    if (title !== orig.title) await api.updateTask(s.id, { title });
    const wasDone = orig.status === 'done';
    if (s.done !== wasDone) await api.taskAction(s.id, s.done ? 'complete' : 'reopen');
  }
  for (const o of originalSubs) {
    if (!kept.has(o.id)) await api.deleteTask(o.id);
  }
}
