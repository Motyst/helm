import { describe, expect, it } from 'vitest';
import { OWNER } from '../src/core/auth/principal.ts';
import { HelmError } from '../src/core/errors.ts';
import { setup, token } from './helpers.ts';

const o = OWNER;

function errCode(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    if (e instanceof HelmError) return e.code;
    throw e;
  }
  throw new Error('expected an error');
}

describe('TaskService.create', () => {
  it('applies defaults and appends in order', () => {
    const { services } = setup();
    const a = services.tasks.create(o, { title: '  Write spec ' });
    const b = services.tasks.create(o, { title: 'Review' });
    expect(a).toMatchObject({ title: 'Write spec', priority: 'soon', status: 'todo', source: 'manual', projectId: null });
    expect(a.position < b.position).toBe(true);
  });

  it('validates input', () => {
    const { services } = setup();
    expect(errCode(() => services.tasks.create(o, { title: '' }))).toBe('invalid');
    expect(errCode(() => services.tasks.create(o, { title: 'x', priority: 'urgent' }))).toBe('invalid');
    expect(errCode(() => services.tasks.create(o, { title: 'x', source: 'robot' }))).toBe('invalid');
    expect(errCode(() => services.tasks.create(o, { title: 'x', projectId: 'nope' }))).toBe('not_found');
  });

  it('subtasks inherit project and priority, and respect max depth', () => {
    const { services } = setup();
    const proj = services.projects.create(o, { name: 'Work' });
    const parent = services.tasks.create(o, { title: 'Parent', projectId: proj.id, priority: 'now' });
    const child = services.tasks.create(o, { title: 'Child', parentTaskId: parent.id });
    expect(child).toMatchObject({ projectId: proj.id, priority: 'now', parentTaskId: parent.id });
    expect(errCode(() => services.tasks.create(o, { title: 'Grandchild', parentTaskId: child.id }))).toBe('invalid');
  });

  it('creates subtasks in the same call, in order', () => {
    const { services } = setup();
    const p = services.tasks.create(o, {
      title: 'Trip',
      priority: 'now',
      subtasks: [{ title: 'Book train' }, { title: 'Pack', estimateMinutes: 20 }],
    });
    const subs = services.tasks.board(o).filter((t) => t.parentTaskId === p.id);
    expect(subs.map((s) => s.title)).toEqual(['Book train', 'Pack']);
    expect(subs[1]).toMatchObject({ priority: 'now', estimateMinutes: 20 });
  });

  it('rejects inline subtasks that would exceed max depth, creating nothing', () => {
    const { services } = setup();
    const p = services.tasks.create(o, { title: 'P' });
    expect(errCode(() => services.tasks.create(o, { title: 'c', parentTaskId: p.id, subtasks: [{ title: 'gc' }] }))).toBe(
      'invalid',
    );
    expect(services.tasks.board(o)).toHaveLength(1);
  });

  it('adding a subtask to a done parent reopens it', () => {
    const { services } = setup();
    const parent = services.tasks.create(o, { title: 'Parent' });
    services.tasks.complete(o, parent.id);
    services.tasks.create(o, { title: 'More work', parentTaskId: parent.id });
    expect(services.tasks.get(o, parent.id).status).toBe('todo');
  });
});

describe('status rules', () => {
  it('starting a task moves the previous in-progress task back to todo (limit 1)', () => {
    const { services, published } = setup();
    const a = services.tasks.create(o, { title: 'A' });
    const b = services.tasks.create(o, { title: 'B' });
    services.tasks.start(o, a.id);
    services.tasks.start(o, b.id);
    expect(services.tasks.get(o, a.id)).toMatchObject({ status: 'todo', startedAt: null });
    expect(services.tasks.get(o, b.id).status).toBe('in_progress');
    expect(published.map((e) => `${e.action}:${e.entityId === a.id ? 'A' : 'B'}`)).toEqual([
      'created:A',
      'created:B',
      'started:A',
      'stopped:A',
      'started:B',
    ]);
  });

  it('limit 0 allows many in progress', () => {
    const { services } = setup({ inProgressLimit: 0 });
    const a = services.tasks.create(o, { title: 'A' });
    const b = services.tasks.create(o, { title: 'B' });
    services.tasks.start(o, a.id);
    services.tasks.start(o, b.id);
    expect(services.tasks.board(o).filter((t) => t.status === 'in_progress')).toHaveLength(2);
  });

  it('completing a parent completes open subtasks; reopening a subtask reopens the parent', () => {
    const { services } = setup();
    const p = services.tasks.create(o, { title: 'P' });
    const c1 = services.tasks.create(o, { title: 'c1', parentTaskId: p.id });
    const c2 = services.tasks.create(o, { title: 'c2', parentTaskId: p.id });
    services.tasks.complete(o, c1.id);
    services.tasks.complete(o, p.id);
    expect(services.tasks.get(o, c2.id).status).toBe('done');
    expect(services.tasks.get(o, p.id).completedAt).not.toBeNull();

    services.tasks.reopen(o, c2.id);
    expect(services.tasks.get(o, p.id)).toMatchObject({ status: 'todo', completedAt: null });
  });

  it('status can also be set via update', () => {
    const { services } = setup();
    const a = services.tasks.create(o, { title: 'A' });
    expect(services.tasks.update(o, a.id, { status: 'done' }).status).toBe('done');
  });
});

describe('update / move / remove', () => {
  it('moving a parent to another project moves its subtasks; subtasks cannot move alone', () => {
    const { services } = setup();
    const work = services.projects.create(o, { name: 'Work' });
    const p = services.tasks.create(o, { title: 'P' });
    const c = services.tasks.create(o, { title: 'c', parentTaskId: p.id });
    services.tasks.update(o, p.id, { projectId: work.id });
    expect(services.tasks.get(o, c.id).projectId).toBe(work.id);
    expect(errCode(() => services.tasks.update(o, c.id, { projectId: null }))).toBe('invalid');
  });

  it('rejects unknown fields', () => {
    const { services } = setup();
    const a = services.tasks.create(o, { title: 'A' });
    expect(errCode(() => services.tasks.update(o, a.id, { parentTaskId: 'x' }))).toBe('invalid');
  });

  it('reorders with afterId / beforeId', () => {
    const { services } = setup();
    const [a, b, c] = ['A', 'B', 'C'].map((title) => services.tasks.create(o, { title }));
    const order = () => services.tasks.board(o).map((t) => t.title).join('');

    services.tasks.move(o, c!.id, { afterId: a!.id });
    expect(order()).toBe('ACB');
    services.tasks.move(o, b!.id, { beforeId: a!.id });
    expect(order()).toBe('BAC');
    services.tasks.move(o, b!.id, { afterId: a!.id, beforeId: c!.id });
    expect(order()).toBe('ABC');
    expect(errCode(() => services.tasks.move(o, a!.id, { afterId: a!.id }))).toBe('invalid');
  });

  it('moves between bins and priorities in one call', () => {
    const { services, published } = setup();
    const home = services.projects.create(o, { name: 'Home' });
    const a = services.tasks.create(o, { title: 'A' });
    const moved = services.tasks.move(o, a.id, { projectId: home.id, priority: 'now' });
    expect(moved).toMatchObject({ projectId: home.id, priority: 'now' });
    expect(published.at(-1)?.action).toBe('moved');
  });

  it('soft-deletes with subtasks', () => {
    const { services } = setup();
    const p = services.tasks.create(o, { title: 'P' });
    services.tasks.create(o, { title: 'c', parentTaskId: p.id });
    services.tasks.remove(o, p.id);
    expect(services.tasks.board(o)).toEqual([]);
    expect(errCode(() => services.tasks.get(o, p.id))).toBe('not_found');
  });
});

describe('reads', () => {
  it('board keeps done subtasks of open parents (for progress) but drops done top-level tasks', () => {
    const { services } = setup();
    const p = services.tasks.create(o, { title: 'P' });
    const c = services.tasks.create(o, { title: 'c', parentTaskId: p.id });
    const done = services.tasks.create(o, { title: 'Done' });
    services.tasks.complete(o, c.id);
    services.tasks.complete(o, done.id);
    expect(services.tasks.board(o).map((t) => t.title)).toEqual(['P', 'c']);
  });

  it('focus returns current and up next', () => {
    const { services } = setup();
    const a = services.tasks.create(o, { title: 'A', priority: 'now' });
    const b = services.tasks.create(o, { title: 'B', priority: 'now' });
    services.tasks.start(o, b.id);
    const f = services.tasks.focus(o);
    expect(f.current?.id).toBe(b.id);
    expect(f.upNext?.id).toBe(a.id);
  });

  it('done log filters by project and date range, newest first', () => {
    const { services, clock } = setup();
    const work = services.projects.create(o, { name: 'Work' });
    const a = services.tasks.create(o, { title: 'A', projectId: work.id });
    const b = services.tasks.create(o, { title: 'B' });
    const c = services.tasks.create(o, { title: 'C', projectId: work.id });
    clock.set('2026-09-20T12:00:00.000Z');
    services.tasks.complete(o, a.id);
    clock.set('2026-09-22T12:00:00.000Z');
    services.tasks.complete(o, b.id);
    services.tasks.complete(o, c.id);

    const titles = (q: object) => services.tasks.doneLog(o, q).map((t) => t.title);
    expect(titles({})).toEqual(['C', 'B', 'A']);
    expect(titles({ projectId: work.id })).toEqual(['C', 'A']);
    expect(titles({ projectId: 'inbox' })).toEqual(['B']);
    expect(titles({ from: '2026-09-21T00:00:00.000Z' })).toEqual(['C', 'B']);
    expect(titles({ to: '2026-09-21T00:00:00.000Z' })).toEqual(['A']);
  });

  it('archived projects drop off the board', () => {
    const { services } = setup();
    const work = services.projects.create(o, { name: 'Work' });
    services.tasks.create(o, { title: 'A', projectId: work.id });
    services.projects.archive(o, work.id);
    expect(services.tasks.board(o)).toEqual([]);
    expect(services.projects.list(o)).toEqual([]);
  });
});

describe('token scopes', () => {
  it('read-only tokens cannot write', () => {
    const { services } = setup();
    const ro = token({ scope: 'read' });
    services.tasks.create(o, { title: 'A' });
    expect(services.tasks.board(ro)).toHaveLength(1);
    expect(errCode(() => services.tasks.create(ro, { title: 'B' }))).toBe('forbidden');
  });

  it('project-scoped tokens only see and write their projects (not the Inbox)', () => {
    const { services } = setup();
    const work = services.projects.create(o, { name: 'Work' });
    const home = services.projects.create(o, { name: 'Home' });
    services.tasks.create(o, { title: 'inbox' });
    const homeTask = services.tasks.create(o, { title: 'home', projectId: home.id });
    services.tasks.create(o, { title: 'work', projectId: work.id });

    const scoped = token({ projectIds: [work.id] });
    expect(services.tasks.board(scoped).map((t) => t.title)).toEqual(['work']);
    expect(services.projects.list(scoped).map((p) => p.name)).toEqual(['Work']);
    expect(errCode(() => services.tasks.get(scoped, homeTask.id))).toBe('forbidden');
    expect(errCode(() => services.tasks.create(scoped, { title: 'x' }))).toBe('forbidden');
    expect(errCode(() => services.projects.create(scoped, { name: 'New' }))).toBe('forbidden');
    expect(services.tasks.create(scoped, { title: 'ok', projectId: work.id }).source).toBe('ai:claude-desktop');
  });

  it('tokens may pass their own ai:<agent> source but not manual', () => {
    const { services } = setup();
    expect(services.tasks.create(token(), { title: 'x', source: 'ai:planner' }).source).toBe('ai:planner');
    expect(services.tasks.create(token(), { title: 'y', source: 'manual' }).source).toBe('ai:claude-desktop');
  });
});

describe('events', () => {
  it('records the actor and publishes nothing when a write fails', () => {
    const { services, published } = setup();
    services.tasks.create(token(), { title: 'A' });
    expect(published[0]).toMatchObject({ actor: 'token:Claude Desktop', entity: 'task', action: 'created' });

    const before = published.length;
    expect(errCode(() => services.tasks.create(o, { title: 'x', parentTaskId: 'missing' }))).toBe('not_found');
    expect(published.length).toBe(before);
  });
});
