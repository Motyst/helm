import { describe, expect, it } from 'vitest';
import type { Timer } from '@helm/shared';
import { formatClock, isDue, remainingMs } from './timer-model.ts';

const base: Timer = {
  id: 't1',
  label: null,
  taskId: null,
  durationMs: 25 * 60_000,
  status: 'running',
  endsAt: '2026-09-28T10:25:00.000Z',
  remainingMs: null,
  ended: false,
  createdAt: '2026-09-28T10:00:00.000Z',
  updatedAt: '2026-09-28T10:00:00.000Z',
};
const at = (iso: string) => Date.parse(iso);

describe('timer model', () => {
  it('counts down a running timer and stops at zero', () => {
    expect(remainingMs(base, at('2026-09-28T10:20:00.000Z'))).toBe(5 * 60_000);
    expect(remainingMs(base, at('2026-09-28T10:30:00.000Z'))).toBe(0);
    expect(isDue(base, at('2026-09-28T10:24:59.000Z'))).toBe(false);
    expect(isDue(base, at('2026-09-28T10:25:00.000Z'))).toBe(true);
  });

  it('holds still while paused and reads zero once finished', () => {
    const paused: Timer = { ...base, status: 'paused', endsAt: null, remainingMs: 90_000 };
    expect(remainingMs(paused, at('2026-09-28T12:00:00.000Z'))).toBe(90_000);
    expect(isDue(paused, at('2026-09-28T12:00:00.000Z'))).toBe(false);
    expect(remainingMs({ ...base, status: 'finished' }, 0)).toBe(0);
  });

  it('formats like a clock, rounding up', () => {
    expect(formatClock(25 * 60_000)).toBe('25:00');
    expect(formatClock(4 * 60_000 + 4_001)).toBe('4:05');
    expect(formatClock(1)).toBe('0:01');
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(3_723_000)).toBe('1:02:03');
  });
});
