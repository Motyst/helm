import { describe, expect, it } from 'vitest';
import { buildTree, type Task } from '@helm/shared';
import { buildColumns, moveAcross, moveInputFor, parseContainer, reorderWithin } from './board-model.ts';

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
    position: `a${String(seq).padStart(3, '0')}`,
    source: 'manual',
    createdAt: '',
    updatedAt: '',
    startedAt: null,
    completedAt: null,
    deletedAt: null,
    ...p,
  };
}

const tasks = [
  task({ id: 'a', projectId: 'P', priority: 'now' }),
  task({ id: 'b', projectId: 'P', priority: 'now' }),
  task({ id: 'c', projectId: 'P', priority: 'soon' }),
  task({ id: 'd', priority: 'now' }),
  task({ id: 'a.1', parentTaskId: 'a', projectId: 'P' }),
];
const byId = new Map(tasks.map((t) => [t.id, t]));
const cols = buildColumns(buildTree(tasks), ['inbox', 'P']);

describe('buildColumns', () => {
  it('creates every container and groups top-level tasks in order', () => {
    expect(Object.keys(cols)).toHaveLength(6);
    expect(cols['P:now']).toEqual(['a', 'b']);
    expect(cols['P:soon']).toEqual(['c']);
    expect(cols['P:someday']).toEqual([]);
    expect(cols['inbox:now']).toEqual(['d']);
  });

  it('parses container ids', () => {
    expect(parseContainer('P:now')).toEqual({ bin: 'P', priority: 'now' });
    expect(parseContainer('bin:P')).toBeNull();
  });
});

describe('drag results', () => {
  it('reorder within a group → neighbours only', () => {
    const next = reorderWithin(cols, 'b', 'a');
    expect(next['P:now']).toEqual(['b', 'a']);
    expect(moveInputFor(next, byId.get('b')!, cols)).toEqual({ beforeId: 'a' });
  });

  it('move to another priority group → priority + neighbours', () => {
    const next = moveAcross(cols, 'b', 'c', 'now');
    expect(next['P:soon']).toEqual(['b', 'c']);
    expect(moveInputFor(next, byId.get('b')!, cols)).toEqual({ priority: 'soon', beforeId: 'c' });
  });

  it('move to another bin → project change', () => {
    const next = moveAcross(cols, 'c', 'd', 'soon');
    expect(next['inbox:now']).toEqual(['c', 'd']);
    expect(moveInputFor(next, byId.get('c')!, cols)).toEqual({ projectId: null, priority: 'now', beforeId: 'd' });
  });

  it('drop on an empty group → no neighbours', () => {
    const next = moveAcross(cols, 'd', 'P:someday', 'now');
    expect(moveInputFor(next, byId.get('d')!, cols)).toEqual({ projectId: 'P', priority: 'someday' });
  });

  it('drop on a collapsed bin header keeps priority and appends', () => {
    const next = moveAcross(cols, 'd', 'bin:P', 'now');
    expect(next['P:now']).toEqual(['a', 'b', 'd']);
    expect(moveInputFor(next, byId.get('d')!, cols)).toEqual({ projectId: 'P', afterId: 'b' });
  });

  it('drop on own container → moves to end', () => {
    const next = reorderWithin(cols, 'a', 'P:now');
    expect(next['P:now']).toEqual(['b', 'a']);
    expect(moveInputFor(next, byId.get('a')!, cols)).toEqual({ afterId: 'b' });
  });

  it('no change → null', () => {
    expect(moveInputFor(cols, byId.get('a')!, cols)).toBeNull();
  });
});
