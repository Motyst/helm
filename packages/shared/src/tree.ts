import type { Task } from './schemas.ts';

export interface Progress {
  done: number;
  total: number;
}

/** A top-level task with its (ordered) subtasks attached. */
export interface TaskNode extends Task {
  subtasks: Task[];
  /** null when the task has no subtasks. */
  progress: Progress | null;
}

/** Fractional-index keys sort with plain string comparison (not localeCompare). */
export function byPosition(a: Pick<Task, 'position' | 'id'>, b: Pick<Task, 'position' | 'id'>): number {
  if (a.position !== b.position) return a.position < b.position ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function progressOf(subtasks: readonly Task[]): Progress | null {
  if (subtasks.length === 0) return null;
  return { done: subtasks.filter((s) => s.status === 'done').length, total: subtasks.length };
}

/**
 * Group a flat task list into top-level nodes with subtasks, both ordered by position.
 * Deleted tasks are dropped. A subtask whose parent is not in the list is treated as top-level.
 */
export function buildTree(tasks: readonly Task[]): TaskNode[] {
  const live = tasks.filter((t) => t.deletedAt === null);
  const ids = new Set(live.map((t) => t.id));
  const children = new Map<string, Task[]>();
  const roots: Task[] = [];

  for (const t of live) {
    if (t.parentTaskId && ids.has(t.parentTaskId)) {
      const list = children.get(t.parentTaskId) ?? [];
      list.push(t);
      children.set(t.parentTaskId, list);
    } else {
      roots.push(t);
    }
  }

  return roots.sort(byPosition).map((t) => {
    const subtasks = (children.get(t.id) ?? []).sort(byPosition);
    return { ...t, subtasks, progress: progressOf(subtasks) };
  });
}
