import type { Project, Task } from '@helm/shared';
import { describe, expect, it } from 'vitest';
import { readNdjson } from '../../lib/api.ts';
import { currentArrangement, describeChange, moveItem } from './assistant-model.ts';

const task = (t: Partial<Task>): Task => ({
  id: 'x',
  title: 'X',
  notes: null,
  projectId: null,
  priority: 'soon',
  estimateMinutes: null,
  status: 'todo',
  parentTaskId: null,
  position: 'a0',
  source: 'manual',
  createdAt: '',
  updatedAt: '',
  startedAt: null,
  completedAt: null,
  deletedAt: null,
  ...t,
});
const tasks = [task({ id: 'r', title: 'Report', position: 'a1' }), task({ id: 'm', title: 'Mail', position: 'a0', priority: 'now' })];
const projects = [{ id: 'w', name: 'Work' } as Project];

describe('describeChange', () => {
  it('puts proposals into words', () => {
    expect(describeChange({ action: 'create', title: 'Draft intro', parentTaskId: 'r', estimateMinutes: 20 }, tasks, projects)).toBe(
      'Add “Draft intro” under “Report”, 20 min',
    );
    expect(describeChange({ action: 'create', title: 'Plan', projectId: 'w', priority: 'now', subtasks: ['a', 'b'] }, tasks, projects)).toBe(
      'Add “Plan” to Work, Now, 2 subtasks',
    );
    expect(describeChange({ action: 'update', taskId: 'r', projectId: null, priority: 'someday' }, tasks, projects)).toBe(
      'Change “Report”: move to Inbox, priority Someday',
    );
    expect(describeChange({ action: 'complete', taskId: 'm' }, tasks, projects)).toBe('Mark “Mail” done');
    expect(describeChange({ action: 'start', taskId: 'gone' }, tasks, projects)).toBe('Start a task that no longer exists');
  });
});

describe('helpers', () => {
  it('moves items and stays put at the ends', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c']);
    expect(moveItem(['a', 'b', 'c'], 0, -1)).toEqual(['a', 'b', 'c']);
  });

  it('captures the current arrangement for undo', () => {
    expect(currentArrangement(tasks, ['r', 'm'])).toEqual([
      { id: 'm', priority: 'now' },
      { id: 'r', priority: 'soon' },
    ]);
  });

  it('reads NDJSON split across chunks', async () => {
    const enc = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        for (const part of ['{"type":"te', 'xt","delta":"a"}\n{"type":"do', 'ne"}\n']) c.enqueue(enc.encode(part));
        c.close();
      },
    });
    const out = [];
    for await (const e of readNdjson(body)) out.push(e);
    expect(out).toEqual([{ type: 'text', delta: 'a' }, { type: 'done' }]);
  });
});
