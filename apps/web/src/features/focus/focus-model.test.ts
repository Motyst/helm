import { describe, expect, it } from 'vitest';
import { buildTree, computeFocus, type Task } from '@helm/shared';
import { minutesLeft, vitalFew, working } from './focus-model.ts';

function task(p: Partial<Task> & { id: string }): Task {
  return {
    title: p.id,
    notes: null,
    projectId: null,
    priority: 'now',
    estimateMinutes: null,
    status: 'todo',
    parentTaskId: null,
    position: p.id,
    source: 'manual',
    createdAt: '',
    updatedAt: '',
    startedAt: null,
    completedAt: null,
    deletedAt: null,
    agentState: null,
    agentClaimedBy: null,
    today: null,
    todayAt: null,
    todayOnly: false,
    ...p,
  };
}

const NOW = Date.parse('2026-09-30T10:35:00Z');
const started = '2026-09-30T10:00:00Z';

describe('working', () => {
  it('times the task and picks the next open step', () => {
    const tasks = [
      task({ id: 'report', status: 'in_progress', startedAt: started, estimateMinutes: 60 }),
      task({ id: 'numbers', parentTaskId: 'report', status: 'done', position: 'a' }),
      task({ id: 'summary', parentTaskId: 'report', position: 'b' }),
      task({ id: 'charts', parentTaskId: 'report', position: 'c' }),
    ];
    const [report] = buildTree(tasks);
    const w = working(report!, null, NOW);
    expect(w).toMatchObject({ elapsed: 35, estimate: 60, left: 25, stepNumber: 2, workingId: 'report' });
    expect(w.step?.id).toBe('summary');
  });

  it('follows an active subtask and goes negative when over', () => {
    const tasks = [
      task({ id: 'report', status: 'in_progress', startedAt: '2026-09-30T09:00:00Z', estimateMinutes: 30 }),
      task({ id: 'numbers', parentTaskId: 'report', position: 'a' }),
      task({ id: 'charts', parentTaskId: 'report', position: 'b', status: 'in_progress', startedAt: started }),
    ];
    const [report] = buildTree(tasks);
    const w = working(report!, 'charts', NOW);
    expect(w).toMatchObject({ elapsed: 35, left: -5, stepNumber: 2, workingId: 'charts' });
  });
});

describe('vitalFew', () => {
  it('takes the task in progress, up next, then the rest of Now', () => {
    const tasks = [
      task({ id: 'a', position: 'a' }),
      task({ id: 'b', position: 'b', status: 'in_progress', startedAt: started, estimateMinutes: 60 }),
      task({ id: 'c', position: 'c', estimateMinutes: 15 }),
      task({ id: 'd', position: 'd', estimateMinutes: 10 }),
      task({ id: 'e', position: 'e', priority: 'someday' }),
    ];
    const focus = computeFocus(tasks);
    const few = vitalFew(focus);
    expect(few.map((t) => t.id)).toEqual(['b', 'a', 'c']);
    const w = working(focus.current!, null, NOW);
    // 25 left on b, nothing estimated on a, 15 on c.
    expect(minutesLeft(few, w, 'b')).toBe(40);
  });

  it('works with nothing in progress or nothing at all', () => {
    expect(vitalFew(computeFocus([task({ id: 'x', priority: 'soon' })])).map((t) => t.id)).toEqual(['x']);
    expect(vitalFew(computeFocus([]))).toEqual([]);
  });
});
