import { byPosition, type AssistantChange, type Priority, type Project, type Task } from '@helm/shared';
import { formatMinutes } from '../../lib/format.ts';

export const PRIORITY_LABEL: Record<Priority, string> = { now: 'Now', soon: 'Soon', someday: 'Someday' };

const quote = (s: string) => `“${s}”`;

/** A proposed change in words, e.g. `Add “Draft intro” under “Report”, 20 min`. */
export function describeChange(c: AssistantChange, tasks: readonly Task[], projects: readonly Project[]): string {
  const title = (id: string) => {
    const t = tasks.find((x) => x.id === id);
    return t ? quote(t.title) : 'a task that no longer exists';
  };
  const project = (id: string | null) => (id ? (projects.find((p) => p.id === id)?.name ?? 'a project') : 'Inbox');

  switch (c.action) {
    case 'create': {
      const where = c.parentTaskId ? ` under ${title(c.parentTaskId)}` : c.projectId !== undefined ? ` to ${project(c.projectId)}` : '';
      const extra = [
        c.priority ? PRIORITY_LABEL[c.priority] : null,
        c.estimateMinutes ? formatMinutes(c.estimateMinutes) : null,
        c.subtasks?.length ? `${c.subtasks.length} subtask${c.subtasks.length === 1 ? '' : 's'}` : null,
      ].filter(Boolean);
      return `Add ${quote(c.title)}${where}${extra.length ? `, ${extra.join(', ')}` : ''}`;
    }
    case 'update': {
      const parts = [
        c.title !== undefined ? `rename to ${quote(c.title)}` : null,
        c.projectId !== undefined ? `move to ${project(c.projectId)}` : null,
        c.priority ? `priority ${PRIORITY_LABEL[c.priority]}` : null,
        c.estimateMinutes ? `estimate ${formatMinutes(c.estimateMinutes)}` : null,
        c.notes !== undefined ? (c.notes ? 'update notes' : 'clear notes') : null,
      ].filter(Boolean);
      return `Change ${title(c.taskId)}: ${parts.join(', ')}`;
    }
    case 'start':
      return `Start ${title(c.taskId)}`;
    case 'stop':
      return `Pause ${title(c.taskId)}`;
    case 'complete':
      return `Mark ${title(c.taskId)} done`;
    case 'reopen':
      return `Reopen ${title(c.taskId)}`;
    case 'arrange':
      return `Reorder ${c.items.length} tasks`;
  }
}

/** Move an item one place up (-1) or down (+1). Returns the same list at the ends. */
export function moveItem<T>(list: readonly T[], index: number, dir: -1 | 1): T[] {
  const to = index + dir;
  if (to < 0 || to >= list.length) return list.slice();
  const next = list.slice();
  [next[index], next[to]] = [next[to]!, next[index]!];
  return next;
}

/** How the given tasks are arranged now: board order and current priorities (for Undo). */
export function currentArrangement(tasks: readonly Task[], ids: readonly string[]): { id: string; priority: Priority }[] {
  const wanted = new Set(ids);
  return tasks
    .filter((t) => wanted.has(t.id))
    .sort(byPosition)
    .map((t) => ({ id: t.id, priority: t.priority }));
}
