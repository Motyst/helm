import type { Focus, Task, TaskNode } from '@helm/shared';
import { minutesSince } from '../../lib/format.ts';

/** Where the task in progress stands, for the layouts that show one task. */
export interface Working {
  startedAt: string | null;
  elapsed: number;
  estimate: number | null;
  /** Minutes left of the estimate; negative when over. null without an estimate. */
  left: number | null;
  /** The subtask to do next: the one in progress, else the first open one. */
  step: Task | null;
  /** 1-based place of `step` among all subtasks. */
  stepNumber: number;
  /** What pausing stops: the active subtask, else the task. */
  workingId: string;
}

export function working(task: TaskNode, activeSubtaskId: string | null, now: number): Working {
  const active = activeSubtaskId ? task.subtasks.find((s) => s.id === activeSubtaskId) : undefined;
  const startedAt = (active ?? task).startedAt;
  const elapsed = startedAt ? minutesSince(startedAt, now) : 0;
  const estimate = task.estimateMinutes;
  const step = active ?? task.subtasks.find((s) => s.status !== 'done') ?? null;
  return {
    startedAt,
    elapsed,
    estimate,
    left: estimate === null ? null : estimate - elapsed,
    step,
    stepNumber: step ? task.subtasks.indexOf(step) + 1 : 0,
    workingId: active?.id ?? task.id,
  };
}

/** The few tasks that matter most: the one in progress, what's up next, then the rest of Now. */
export function vitalFew(focus: Focus, count = 3): TaskNode[] {
  const out: TaskNode[] = [];
  for (const t of [focus.current, focus.upNext, ...focus.now]) {
    if (t && !out.some((x) => x.id === t.id)) out.push(t);
    if (out.length === count) break;
  }
  return out;
}

/** Minutes of work left in these tasks: estimates, minus time already spent on the one in progress. */
export function minutesLeft(tasks: TaskNode[], current: Working | null, currentId: string | null): number {
  return tasks.reduce((sum, t) => {
    if (t.id === currentId && current) return sum + Math.max(current.left ?? 0, 0);
    return sum + (t.estimateMinutes ?? 0);
  }, 0);
}
