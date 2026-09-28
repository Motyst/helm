import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Timer } from '@helm/shared';
import { api } from '../../lib/api.ts';
import { playChime, vibrate } from '../../lib/chime.ts';
import { useTimer, useTimerAction } from '../../lib/queries.ts';
import { isDue, remainingMs } from './timer-model.ts';
import './timer.css';

interface TimerState {
  timer: Timer | null;
  /** Time left, updated twice a second while running. */
  remaining: number;
  /** Rung: reached zero here or on the server. */
  due: boolean;
}

const TimerCtx = createContext<TimerState>({ timer: null, remaining: 0, due: false });
export const useTimerState = () => useContext(TimerCtx);

/** Only chime for a timer that rang just now, not one found finished when Helm opens later. */
const FRESH_MS = 60_000;

/** Keeps the countdown ticking, rings it (sound, vibration, banner) and shares it app-wide. */
export function TimerProvider({ children }: { children: ReactNode }) {
  const timer = useTimer().data ?? null;
  const [now, setNow] = useState(() => Date.now());
  const running = timer?.status === 'running';

  useEffect(() => {
    setNow(Date.now());
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [running, timer?.updatedAt]);

  const due = timer ? isDue(timer, now) : false;
  const remaining = timer ? remainingMs(timer, now) : 0;

  // Ring once per countdown (adding time makes a new one: durationMs changes).
  const rung = useRef<string | null>(null);
  useEffect(() => {
    if (!timer || !due) return;
    const key = `${timer.id}:${timer.durationMs}`;
    if (rung.current === key) return;
    rung.current = key;
    const endedAt = timer.endsAt ? Date.parse(timer.endsAt) : now;
    if (Math.abs(Date.now() - endedAt) < FRESH_MS) {
      playChime();
      vibrate();
    }
  }, [timer, due, now]);

  return (
    <TimerCtx.Provider value={{ timer, remaining, due }}>
      {children}
      {timer && due && <TimeUpBanner timer={timer} />}
    </TimerCtx.Provider>
  );
}

function TimeUpBanner({ timer }: { timer: Timer }) {
  const extend = useTimerAction((m: number) => api.extendTimer(m));
  const stop = useTimerAction(() => api.stopTimer());
  return (
    <div className="timeup" role="alert">
      <div className="timeup-text">
        <strong>Time’s up</strong>
        {timer.label && <span>{timer.label}</span>}
      </div>
      <div className="timeup-actions">
        <button className="btn" disabled={extend.isPending} onClick={() => extend.mutate(5)}>
          5 more min
        </button>
        <button className="btn btn-primary" disabled={stop.isPending} onClick={() => stop.mutate(undefined)}>
          Dismiss
        </button>
      </div>
    </div>
  );
}
