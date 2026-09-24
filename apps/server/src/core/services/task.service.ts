import { and, asc, desc, eq, gt, gte, inArray, isNotNull, isNull, lt, max, ne, or, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { projects, tasks, type TaskRow, type Tx } from '@helm/db';
import {
  CreateTaskInput,
  DoneLogQuery,
  INBOX,
  MoveTaskInput,
  UpdateTaskInput,
  computeFocus,
  type DoneLogPage,
  type Focus,
  type Task,
  type TaskStatus,
} from '@helm/shared';
import { ulid } from 'ulidx';
import { assertRead, assertWrite, projectScope, type Principal } from '../auth/principal.ts';
import { invalid, notFound, parse } from '../errors.ts';
import { mutate, type Emit, type ServiceContext } from './context.ts';
import { toTask } from './mappers.ts';
import { keyAfter, keyBetweenNeighbours } from './ordering.ts';
import { getLiveProject } from './project.service.ts';

type Patch = Partial<Omit<TaskRow, 'id' | 'createdAt'>>;

export class TaskService {
  constructor(private readonly ctx: ServiceContext) {}

  // ---------- Reads ----------

  get(p: Principal, id: string): Task {
    const row = this.getRow(this.ctx.db, id);
    assertRead(p, row.projectId);
    return toTask(row);
  }

  /**
   * Everything the live board needs: all open tasks, plus done subtasks of open parents
   * (for "2/5" progress). Tasks in archived projects are excluded.
   */
  board(p: Principal): Task[] {
    const parent = alias(tasks, 'parent');
    return this.ctx.db
      .select()
      .from(tasks)
      .leftJoin(parent, eq(parent.id, tasks.parentTaskId))
      .leftJoin(projects, eq(projects.id, tasks.projectId))
      .where(
        and(
          isNull(tasks.deletedAt),
          isNull(projects.archivedAt),
          or(
            ne(tasks.status, 'done'),
            and(isNotNull(tasks.parentTaskId), ne(parent.status, 'done'), isNull(parent.deletedAt)),
          ),
          this.scopeFilter(p),
        ),
      )
      .orderBy(asc(tasks.position), asc(tasks.id))
      .all()
      .map((r) => toTask(r.tasks));
  }

  focus(p: Principal): Focus {
    return computeFocus(this.board(p));
  }

  /** Completed tasks, newest first. */
  doneLog(p: Principal, query: unknown = {}): DoneLogPage {
    const q = parse(DoneLogQuery, query);
    const limit = q.limit ?? 200;
    const project: SQL | undefined =
      q.projectId === undefined
        ? undefined
        : q.projectId === INBOX
          ? isNull(tasks.projectId)
          : eq(tasks.projectId, q.projectId);
    // Keyset paging on (completed_at, id): a whole parent + subtasks can share one timestamp.
    let after: SQL | undefined;
    if (q.cursor) {
      const [ms, id] = q.cursor.split(':') as [string, string];
      const at = new Date(Number(ms));
      after = or(lt(tasks.completedAt, at), and(eq(tasks.completedAt, at), lt(tasks.id, id)));
    }
    const rows = this.ctx.db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.status, 'done'),
          isNull(tasks.deletedAt),
          q.includeSubtasks ? undefined : isNull(tasks.parentTaskId),
          q.from ? gte(tasks.completedAt, new Date(q.from)) : undefined,
          q.to ? lt(tasks.completedAt, new Date(q.to)) : undefined,
          project,
          after,
          this.scopeFilter(p),
        ),
      )
      .orderBy(desc(tasks.completedAt), desc(tasks.id))
      .limit(limit + 1)
      .all();
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      tasks: page.map(toTask),
      nextCursor: rows.length > limit && last ? `${last.completedAt!.getTime()}:${last.id}` : null,
    };
  }

  // ---------- Writes ----------

  create(p: Principal, input: unknown): Task {
    const i = parse(CreateTaskInput, input);
    return mutate(this.ctx, p, (tx, emit) => {
      let projectId = i.projectId ?? null;
      let priority = i.priority ?? 'soon';
      let parent: TaskRow | null = null;

      if (i.parentTaskId) {
        parent = this.getRow(tx, i.parentTaskId);
        if (this.depthOf(tx, parent) + 1 > this.ctx.rules.maxSubtaskDepth) {
          throw invalid(`Subtasks can be nested at most ${this.ctx.rules.maxSubtaskDepth} level(s) deep`);
        }
        // Subtasks always live in their parent's project.
        projectId = parent.projectId;
        priority = i.priority ?? parent.priority;
      } else if (projectId) {
        getLiveProject(tx, projectId);
      }
      assertWrite(p, projectId);

      const depth = parent ? this.depthOf(tx, parent) + 1 : 0;
      if (i.subtasks?.length && depth + 1 > this.ctx.rules.maxSubtaskDepth) {
        throw invalid(`Subtasks can be nested at most ${this.ctx.rules.maxSubtaskDepth} level(s) deep`);
      }

      const source = sourceFor(p, i.source);
      const insert = (values: {
        title: string;
        notes?: string | null;
        estimateMinutes?: number | null;
        parentTaskId: string | null;
      }) => {
        const now = this.ctx.now();
        const row = tx
          .insert(tasks)
          .values({
            id: ulid(),
            title: values.title,
            notes: values.notes ?? null,
            projectId,
            priority,
            estimateMinutes: values.estimateMinutes ?? null,
            status: 'todo',
            parentTaskId: values.parentTaskId,
            position: keyAfter(this.lastSiblingPosition(tx, values.parentTaskId)),
            source,
            createdAt: now,
            updatedAt: now,
          })
          .returning()
          .get();
        emitTask(emit, 'created', row);
        return row;
      };

      const row = insert({ ...i, parentTaskId: parent?.id ?? null });
      for (const sub of i.subtasks ?? []) insert({ ...sub, parentTaskId: row.id });

      // A done parent can't have open subtasks.
      if (parent?.status === 'done') this.transition(tx, emit, parent, 'todo');
      return toTask(row);
    });
  }

  update(p: Principal, id: string, input: unknown): Task {
    const patch = parse(UpdateTaskInput, input);
    return mutate(this.ctx, p, (tx, emit) => {
      let row = this.getRow(tx, id);
      assertWrite(p, row.projectId);

      const fields: Patch = {};
      if (patch.title !== undefined) fields.title = patch.title;
      if (patch.notes !== undefined) fields.notes = patch.notes;
      if (patch.priority !== undefined) fields.priority = patch.priority;
      if (patch.estimateMinutes !== undefined) fields.estimateMinutes = patch.estimateMinutes;
      if (patch.projectId !== undefined && patch.projectId !== row.projectId) {
        this.checkProjectChange(tx, p, row, patch.projectId);
        fields.projectId = patch.projectId;
      }

      if (Object.keys(fields).length > 0) {
        row = this.write(tx, row.id, fields);
        emitTask(emit, 'updated', row);
        if (fields.projectId !== undefined) this.cascadeProject(tx, emit, row);
      }
      if (patch.status !== undefined) row = this.transition(tx, emit, row, patch.status);
      return toTask(row);
    });
  }

  /** Drag & drop: change project and/or priority and/or position in one step. */
  move(p: Principal, id: string, input: unknown): Task {
    const m = parse(MoveTaskInput, input);
    return mutate(this.ctx, p, (tx, emit) => {
      let row = this.getRow(tx, id);
      assertWrite(p, row.projectId);

      const fields: Patch = {};
      if (m.projectId !== undefined && m.projectId !== row.projectId) {
        this.checkProjectChange(tx, p, row, m.projectId);
        fields.projectId = m.projectId;
      }
      if (m.priority !== undefined && m.priority !== row.priority) fields.priority = m.priority;
      if (m.afterId || m.beforeId) fields.position = this.positionFor(tx, p, row, m.afterId ?? null, m.beforeId ?? null);
      if (Object.keys(fields).length === 0) return toTask(row);

      row = this.write(tx, row.id, fields);
      emitTask(emit, 'moved', row);
      if (fields.projectId !== undefined) this.cascadeProject(tx, emit, row);
      return toTask(row);
    });
  }

  setStatus(p: Principal, id: string, status: TaskStatus): Task {
    return mutate(this.ctx, p, (tx, emit) => {
      const row = this.getRow(tx, id);
      assertWrite(p, row.projectId);
      return toTask(this.transition(tx, emit, row, status));
    });
  }

  start = (p: Principal, id: string) => this.setStatus(p, id, 'in_progress');
  stop = (p: Principal, id: string) => this.setStatus(p, id, 'todo');
  complete = (p: Principal, id: string) => this.setStatus(p, id, 'done');
  reopen = (p: Principal, id: string) => this.setStatus(p, id, 'todo');

  /** Soft delete, including subtasks. */
  remove(p: Principal, id: string): Task {
    return mutate(this.ctx, p, (tx, emit) => {
      const row = this.getRow(tx, id);
      assertWrite(p, row.projectId);
      const now = this.ctx.now();
      for (const child of this.children(tx, row.id)) {
        emitTask(emit, 'deleted', this.write(tx, child.id, { deletedAt: now }));
      }
      const deleted = this.write(tx, row.id, { deletedAt: now });
      emitTask(emit, 'deleted', deleted);
      return toTask(deleted);
    });
  }

  // ---------- Status rules ----------

  /**
   * Apply a status change and its knock-on effects:
   * - starting respects the in-progress limit (oldest in-progress task is moved back to todo)
   * - completing a parent completes its open subtasks
   * - reopening/starting a subtask (or adding one) reopens a done parent
   */
  private transition(tx: Tx, emit: Emit, row: TaskRow, to: TaskStatus): TaskRow {
    if (row.status === to) return row;
    const now = this.ctx.now();
    let updated: TaskRow;

    if (to === 'in_progress') {
      this.makeRoomToStart(tx, emit, row.id);
      updated = this.write(tx, row.id, { status: to, startedAt: now, completedAt: null });
      emitTask(emit, 'started', updated);
    } else if (to === 'done') {
      updated = this.write(tx, row.id, { status: to, completedAt: now });
      emitTask(emit, 'completed', updated);
      for (const child of this.children(tx, row.id)) {
        if (child.status !== 'done') this.transition(tx, emit, child, 'done');
      }
    } else {
      updated = this.write(tx, row.id, { status: to, startedAt: null, completedAt: null });
      emitTask(emit, row.status === 'done' ? 'reopened' : 'stopped', updated);
    }

    if (to !== 'done' && row.parentTaskId) {
      const parent = this.getRow(tx, row.parentTaskId);
      if (parent.status === 'done') this.transition(tx, emit, parent, 'todo');
    }
    return updated;
  }

  private makeRoomToStart(tx: Tx, emit: Emit, startingId: string): void {
    const limit = this.ctx.rules.inProgressLimit;
    if (limit <= 0) return;
    const active = tx
      .select()
      .from(tasks)
      .where(and(eq(tasks.status, 'in_progress'), isNull(tasks.deletedAt), ne(tasks.id, startingId)))
      .orderBy(asc(tasks.startedAt))
      .all();
    while (active.length >= limit) {
      const oldest = active.shift()!;
      this.transition(tx, emit, oldest, 'todo');
    }
  }

  // ---------- Helpers ----------

  private getRow(tx: Tx, id: string): TaskRow {
    const row = tx.select().from(tasks).where(and(eq(tasks.id, id), isNull(tasks.deletedAt))).get();
    if (!row) throw notFound('Task');
    return row;
  }

  private write(tx: Tx, id: string, fields: Patch): TaskRow {
    return tx
      .update(tasks)
      .set({ ...fields, updatedAt: this.ctx.now() })
      .where(eq(tasks.id, id))
      .returning()
      .get()!;
  }

  private children(tx: Tx, parentId: string): TaskRow[] {
    return tx
      .select()
      .from(tasks)
      .where(and(eq(tasks.parentTaskId, parentId), isNull(tasks.deletedAt)))
      .all();
  }

  private depthOf(tx: Tx, row: TaskRow): number {
    let depth = 0;
    let cur = row;
    while (cur.parentTaskId && depth < 32) {
      depth++;
      cur = this.getRow(tx, cur.parentTaskId);
    }
    return depth;
  }

  private checkProjectChange(tx: Tx, p: Principal, row: TaskRow, projectId: string | null): void {
    if (row.parentTaskId) throw invalid("Subtasks follow their parent's project; move the parent instead");
    if (projectId) getLiveProject(tx, projectId);
    assertWrite(p, projectId);
  }

  private cascadeProject(tx: Tx, emit: Emit, parent: TaskRow): void {
    for (const child of this.children(tx, parent.id)) {
      emitTask(emit, 'moved', this.write(tx, child.id, { projectId: parent.projectId }));
    }
  }

  private siblingsOf(parentId: string | null): SQL {
    return parentId ? eq(tasks.parentTaskId, parentId) : isNull(tasks.parentTaskId);
  }

  private lastSiblingPosition(tx: Tx, parentId: string | null): string | null {
    return tx.select({ v: max(tasks.position) }).from(tasks).where(this.siblingsOf(parentId)).get()?.v ?? null;
  }

  private positionFor(tx: Tx, p: Principal, row: TaskRow, afterId: string | null, beforeId: string | null): string {
    const neighbour = (nid: string) => {
      const n = this.getRow(tx, nid);
      assertRead(p, n.projectId);
      if (n.id === row.id || n.parentTaskId !== row.parentTaskId) {
        throw invalid('afterId/beforeId must be a sibling of the moved task');
      }
      return n.position;
    };
    const others = and(this.siblingsOf(row.parentTaskId), isNull(tasks.deletedAt), ne(tasks.id, row.id));
    const adjacent = (dir: 'next' | 'prev') => (pos: string) =>
      tx
        .select({ v: tasks.position })
        .from(tasks)
        .where(and(others, dir === 'next' ? gt(tasks.position, pos) : lt(tasks.position, pos)))
        .orderBy(dir === 'next' ? asc(tasks.position) : desc(tasks.position))
        .limit(1)
        .get()?.v ?? null;

    return keyBetweenNeighbours(
      afterId ? neighbour(afterId) : null,
      beforeId ? neighbour(beforeId) : null,
      adjacent('next'),
      adjacent('prev'),
    );
  }

  private scopeFilter(p: Principal): SQL | undefined {
    const scope = projectScope(p);
    return scope ? inArray(tasks.projectId, scope) : undefined;
  }
}

function emitTask(emit: Emit, action: string, row: TaskRow): void {
  emit({ entity: 'task', entityId: row.id, projectId: row.projectId, action, data: toTask(row) });
}

/** Owner picks freely (default manual). Tokens are always recorded as `ai:<something>`. */
function sourceFor(p: Principal, requested: string | undefined): string {
  if (p.kind === 'owner') return requested ?? 'manual';
  if (requested?.startsWith('ai:')) return requested;
  const slug = p.name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[^a-z0-9]+/, '')
    .slice(0, 64);
  return `ai:${slug || 'agent'}`;
}
