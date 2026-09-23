import { describe, expect, it } from 'vitest';
import { computeFocus } from './focus.ts';
import { buildTree } from './tree.ts';
import type { Task } from './schemas.ts';

let seq = 0;
function task(p: Partial<Task> & { id: string }): Task {
  seq++;
  return {
    title: p.id,
    notes: null,
    projectId: null,
    priority: 'soon',
    estimateMinutes: null,
    status: 'todo',
    parentTaskId: null,
    position: `a${seq}`,
    source: 'manual',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    startedAt: null,
    completedAt: null,
    deletedAt: null,
    ...p,
  };
}

describe('buildTree', () => {
  it('nests subtasks, orders by position and computes progress', () => {
    const tree = buildTree([
      task({ id: 'b', position: 'a2' }),
      task({ id: 'a', position: 'a1' }),
      task({ id: 'a.2', parentTaskId: 'a', position: 'a2', status: 'done' }),
      task({ id: 'a.1', parentTaskId: 'a', position: 'a1' }),
      task({ id: 'gone', deletedAt: '2026-01-02T00:00:00.000Z' }),
    ]);
    expect(tree.map((n) => n.id)).toEqual(['a', 'b']);
    expect(tree[0]!.subtasks.map((s) => s.id)).toEqual(['a.1', 'a.2']);
    expect(tree[0]!.progress).toEqual({ done: 1, total: 2 });
    expect(tree[1]!.progress).toBeNull();
  });
});

describe('computeFocus', () => {
  it('returns empty focus for no tasks', () => {
    expect(computeFocus([])).toEqual({ current: null, activeSubtaskId: null, alsoInProgress: [], upNext: null, now: [] });
  });

  it('picks current, up next and remaining now list', () => {
    const f = computeFocus([
      task({ id: 'n1', priority: 'now', position: 'a1' }),
      task({ id: 'n2', priority: 'now', position: 'a2', status: 'in_progress', startedAt: '2026-01-01T10:00:00.000Z' }),
      task({ id: 'n3', priority: 'now', position: 'a3' }),
      task({ id: 's1', priority: 'soon', position: 'a0' }),
      task({ id: 'd', priority: 'now', position: 'a4', status: 'done' }),
    ]);
    expect(f.current?.id).toBe('n2');
    expect(f.upNext?.id).toBe('n1');
    expect(f.now.map((n) => n.id)).toEqual(['n3']);
  });

  it('falls back to Soon for up next when Now is empty', () => {
    const f = computeFocus([task({ id: 's1', priority: 'soon' }), task({ id: 'x', priority: 'someday' })]);
    expect(f.current).toBeNull();
    expect(f.upNext?.id).toBe('s1');
  });

  it('shows the parent as current when a subtask is in progress', () => {
    const f = computeFocus([
      task({ id: 'p', priority: 'now' }),
      task({ id: 'p.1', parentTaskId: 'p', status: 'in_progress', startedAt: '2026-01-01T10:00:00.000Z' }),
    ]);
    expect(f.current?.id).toBe('p');
    expect(f.activeSubtaskId).toBe('p.1');
    expect(f.upNext).toBeNull();
  });

  it('uses the most recently started task as current', () => {
    const f = computeFocus([
      task({ id: 'old', priority: 'now', status: 'in_progress', startedAt: '2026-01-01T09:00:00.000Z' }),
      task({ id: 'new', priority: 'soon', status: 'in_progress', startedAt: '2026-01-01T11:00:00.000Z' }),
    ]);
    expect(f.current?.id).toBe('new');
    expect(f.alsoInProgress.map((n) => n.id)).toEqual(['old']);
  });
});
