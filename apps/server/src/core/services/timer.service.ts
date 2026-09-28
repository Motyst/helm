import { desc, eq, isNull } from 'drizzle-orm';
import { timers, type TimerRow, type Tx } from '@helm/db';
import { ExtendTimerInput, StartTimerInput, type Timer } from '@helm/shared';
import { ulid } from 'ulidx';
import { assertOwner, OWNER, type Principal } from '../auth/principal.ts';
import { HelmError, notFound, parse } from '../errors.ts';
import { mutate, type Emit, type ServiceContext } from './context.ts';
import { toTimer } from './mappers.ts';

const MINUTE = 60_000;

/** The one countdown: start, pause, resume, add time, stop. The timer module rings it. */
export class TimerService {
  constructor(private readonly ctx: ServiceContext) {}

  /** The live timer (running, paused, or finished and not dismissed), or null. */
  current(p: Principal): Timer | null {
    assertOwner(p);
    const row = this.live(this.ctx.db);
    return row ? toTimer(row) : null;
  }

  /** Start a new countdown; one already live is stopped. */
  start(p: Principal, input: unknown): Timer {
    const i = parse(StartTimerInput, input);
    assertOwner(p);
    return mutate(this.ctx, p, (tx, emit) => {
      const now = this.ctx.now();
      const old = this.live(tx);
      if (old) this.write(tx, emit, old, 'stopped', { endedAt: now });
      const durationMs = Math.round(i.minutes * MINUTE);
      const row = tx
        .insert(timers)
        .values({
          id: ulid(),
          label: i.label || null,
          taskId: i.taskId ?? null,
          durationMs,
          endsAt: new Date(now.getTime() + durationMs),
          createdAt: now,
          updatedAt: now,
        })
        .returning()
        .get();
      emitTimer(emit, 'started', row);
      return toTimer(row);
    });
  }

  pause(p: Principal): Timer {
    return this.change(p, (row, now) => {
      if (row.finishedAt || !row.endsAt) throw conflict('The timer isn’t running.');
      return ['paused', { endsAt: null, remainingMs: Math.max(0, row.endsAt.getTime() - now.getTime()) }];
    });
  }

  resume(p: Principal): Timer {
    return this.change(p, (row, now) => {
      if (row.finishedAt || row.remainingMs === null) throw conflict('The timer isn’t paused.');
      return ['resumed', { endsAt: new Date(now.getTime() + row.remainingMs), remainingMs: null }];
    });
  }

  /** Add time. A timer that has already rung counts down again from now. */
  extend(p: Principal, input: unknown): Timer {
    const { minutes } = parse(ExtendTimerInput, input);
    const add = Math.round(minutes * MINUTE);
    return this.change(p, (row, now) => {
      const durationMs = row.durationMs + add;
      if (row.finishedAt) return ['extended', { durationMs, finishedAt: null, endsAt: new Date(now.getTime() + add) }];
      if (row.remainingMs !== null) return ['extended', { durationMs, remainingMs: row.remainingMs + add }];
      return ['extended', { durationMs, endsAt: new Date(row.endsAt!.getTime() + add) }];
    });
  }

  /** Stop a timer that is counting, or dismiss one that has rung. */
  stop(p: Principal): Timer {
    return this.change(p, (row, now) => [row.finishedAt ? 'dismissed' : 'stopped', { endedAt: now }]);
  }

  /** Mark a running timer as rung if it is due. Returns it only when this call rang it. */
  finishIfDue(id: string): Timer | null {
    return mutate(this.ctx, OWNER, (tx, emit) => {
      const row = tx.select().from(timers).where(eq(timers.id, id)).get();
      const now = this.ctx.now();
      if (!row || row.endedAt || row.finishedAt || !row.endsAt || row.endsAt > now) return null;
      return this.write(tx, emit, row, 'finished', { finishedAt: now });
    });
  }

  /** The running timer's id and when it rings, for the scheduler. */
  next(): { id: string; endsAt: Date } | null {
    const row = this.live(this.ctx.db);
    return row && !row.finishedAt && row.endsAt ? { id: row.id, endsAt: row.endsAt } : null;
  }

  private live(tx: Tx): TimerRow | undefined {
    return tx
      .select()
      .from(timers)
      .where(isNull(timers.endedAt))
      .orderBy(desc(timers.createdAt), desc(timers.id))
      .limit(1)
      .get();
  }

  private change(p: Principal, fn: (row: TimerRow, now: Date) => [string, Partial<TimerRow>]): Timer {
    assertOwner(p);
    return mutate(this.ctx, p, (tx, emit) => {
      const row = this.live(tx);
      if (!row) throw notFound('Timer');
      const [action, patch] = fn(row, this.ctx.now());
      return this.write(tx, emit, row, action, patch);
    });
  }

  private write(tx: Tx, emit: Emit, row: TimerRow, action: string, patch: Partial<TimerRow>): Timer {
    const updated = tx
      .update(timers)
      .set({ ...patch, updatedAt: this.ctx.now() })
      .where(eq(timers.id, row.id))
      .returning()
      .get()!;
    emitTimer(emit, action, updated);
    return toTimer(updated);
  }
}

const conflict = (msg: string) => new HelmError('conflict', msg);

function emitTimer(emit: Emit, action: string, row: TimerRow): void {
  emit({ entity: 'timer', entityId: row.id, projectId: null, action, data: toTimer(row) });
}
