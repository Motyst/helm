import type { Task, TaskNode } from '@helm/shared';

export const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** In the order they went on Today. */
const byPlanned = (a: Task, b: Task) => (a.todayAt ?? '').localeCompare(b.todayAt ?? '') || a.id.localeCompare(b.id);

/** Open tasks on Today, split into main and side. */
export function todayLists(roots: readonly TaskNode[]): { main: TaskNode[]; side: TaskNode[] } {
  const open = roots.filter((t) => t.today && t.status !== 'done' && !t.deletedAt).sort(byPlanned);
  return { main: open.filter((t) => t.today === 'main'), side: open.filter((t) => t.today === 'side') };
}

/** For a task still on Today from an earlier day: "yesterday", "Monday" or "29 Sep". */
export function carriedFrom(t: Pick<Task, 'todayAt'>, now: Date): string | null {
  if (!t.todayAt) return null;
  const at = new Date(t.todayAt);
  const start = startOfDay(now);
  if (at >= start) return null;
  // Rounded: a day with a clock change is 23 or 25 hours long.
  const days = Math.round((start.getTime() - startOfDay(at).getTime()) / 86_400_000);
  if (days <= 1) return 'yesterday';
  if (days < 7) return at.toLocaleDateString([], { weekday: 'long' });
  return at.toLocaleDateString([], { day: 'numeric', month: 'short' });
}

/**
 * Today's tasks finished today. `live` is the task cache (fresh as you tick things off), `log` the
 * done log since midnight (which also has them after a reload); the cache wins when both have one.
 */
export function doneToday(live: readonly Task[], log: readonly Task[], now: Date): Task[] {
  const start = startOfDay(now).getTime();
  const byId = new Map<string, Task>();
  for (const t of log) byId.set(t.id, t);
  for (const t of live) if (byId.has(t.id) || t.status === 'done') byId.set(t.id, t);
  return [...byId.values()]
    .filter(
      (t) =>
        t.today && !t.parentTaskId && !t.deletedAt && t.status === 'done' && t.completedAt && Date.parse(t.completedAt) >= start,
    )
    .sort((a, b) => a.completedAt!.localeCompare(b.completedAt!));
}

/** Estimates of what's left, in minutes. */
export const minutesLeft = (tasks: readonly Task[]) => tasks.reduce((sum, t) => sum + (t.estimateMinutes ?? 0), 0);
