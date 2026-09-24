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
}

export function draftFrom(task: Task, subtasks: Task[]): TaskDraft {
  return {
    title: task.title,
    notes: task.notes ?? '',
    projectId: task.projectId,
    priority: task.priority,
    estimateMinutes: task.estimateMinutes,
    subtasks: subtasks.map((s) => ({ key: s.id, id: s.id, title: s.title, done: s.status === 'done' })),
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
  });
}

/**
 * Apply an edited draft: one PATCH for the task's own fields, then subtask creates / renames /
 * status changes / deletes. Live events update the cache as each lands.
 */
export async function saveDraft(task: Task, originalSubs: Task[], d: TaskDraft): Promise<void> {
  const patch: UpdateTaskInput = {};
  if (d.title !== task.title) patch.title = d.title;
  if (cleanNotes(d.notes) !== task.notes) patch.notes = cleanNotes(d.notes);
  if (d.priority !== task.priority) patch.priority = d.priority;
  if (d.estimateMinutes !== task.estimateMinutes) patch.estimateMinutes = d.estimateMinutes;
  if (d.projectId !== task.projectId && !task.parentTaskId) patch.projectId = d.projectId;
  if (Object.keys(patch).length) await api.updateTask(task.id, patch);

  const kept = new Set<string>();
  for (const s of d.subtasks) {
    const title = s.title.trim();
    if (!s.id) {
      if (!title) continue;
      const created = await api.createTask({ title, parentTaskId: task.id });
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
