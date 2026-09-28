import type { Timer } from '@helm/shared';

/** Minutes offered as one-tap timers. */
export const PRESETS = [5, 15, 25, 45] as const;

/** Time left on a timer at `now` (ms since epoch); 0 once it has rung. */
export function remainingMs(t: Timer, now: number): number {
  if (t.status === 'paused') return t.remainingMs ?? 0;
  if (t.status === 'finished' || !t.endsAt) return 0;
  return Math.max(0, Date.parse(t.endsAt) - now);
}

/** Whether a running timer has reached zero on this device's clock (the server may lag a moment). */
export function isDue(t: Timer, now: number): boolean {
  return t.status === 'finished' || (t.status === 'running' && remainingMs(t, now) === 0);
}

/** "4:05", "25:00", "1:02:03". Rounds up, so it reads 0:00 only when time is up. */
export function formatClock(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** "3 min", "1 h 30 min" for the spoken label. */
export function describeClock(ms: number): string {
  const min = Math.ceil(ms / 60_000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return min % 60 ? `${h} h ${min % 60} min` : `${h} h`;
}
