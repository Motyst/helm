import { useEffect, useId, useState, type FormEvent } from 'react';
import { api } from '../../lib/api.ts';
import { unlockAudio } from '../../lib/chime.ts';
import { enablePush, pushState, type PushState } from '../../lib/push.ts';
import { useTimerAction } from '../../lib/queries.ts';
import { useTimerState } from './TimerContext.tsx';
import { describeClock, formatClock, PRESETS } from './timer-model.ts';

/** Start a countdown, or run the one going. `label`/`taskId`: the task in progress, if any. */
export function TimerCard({ label, taskId }: { label: string | null; taskId: string | null }) {
  const { timer, remaining, due } = useTimerState();
  const start = useTimerAction((minutes: number) => api.startTimer({ minutes, label, taskId }));
  const pause = useTimerAction(() => api.pauseTimer());
  const resume = useTimerAction(() => api.resumeTimer());
  const extend = useTimerAction((m: number) => api.extendTimer(m));
  const stop = useTimerAction(() => api.stopTimer());
  const busy = start.isPending || pause.isPending || resume.isPending || extend.isPending || stop.isPending;
  const [custom, setCustom] = useState('');
  const customId = useId();

  const begin = (minutes: number) => {
    unlockAudio();
    start.mutate(minutes);
  };

  function submitCustom(e: FormEvent) {
    e.preventDefault();
    const minutes = Number(custom.replace(',', '.'));
    if (!(minutes > 0 && minutes <= 24 * 60)) return;
    begin(minutes);
    setCustom('');
  }

  return (
    <div className="queue-block timer-card">
      <h2 className="queue-heading">
        Timer
        {timer && timer.label && <span className="queue-sum timer-for">{timer.label}</span>}
      </h2>

      {timer ? (
        <>
          <p
            className={`timer-clock ${due ? 'is-due' : ''} ${timer.status === 'paused' ? 'is-paused' : ''}`}
            role="timer"
            aria-label={due ? 'Time’s up' : `${describeClock(remaining)} left${timer.status === 'paused' ? ', paused' : ''}`}
          >
            {due ? 'Time’s up' : formatClock(remaining)}
          </p>
          <div className="timer-actions">
            {!due &&
              (timer.status === 'paused' ? (
                <button
                  className="btn btn-primary"
                  disabled={busy}
                  aria-label="Resume timer"
                  onClick={() => {
                    unlockAudio();
                    resume.mutate(undefined);
                  }}
                >
                  Resume
                </button>
              ) : (
                <button className="btn" disabled={busy} aria-label="Pause timer" onClick={() => pause.mutate(undefined)}>
                  Pause
                </button>
              ))}
            <button className="btn" disabled={busy} aria-label="Add 5 minutes" onClick={() => extend.mutate(5)}>
              +5 min
            </button>
            <button
              className="btn btn-quiet"
              disabled={busy}
              aria-label={due ? 'Dismiss timer' : 'Stop timer'}
              onClick={() => stop.mutate(undefined)}
            >
              {due ? 'Dismiss' : 'Stop'}
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="timer-presets">
            {PRESETS.map((m) => (
              <button key={m} className="btn" disabled={busy} aria-label={`Start a ${m} minute timer`} onClick={() => begin(m)}>
                {m} min
              </button>
            ))}
          </div>
          <form className="timer-custom" autoComplete="off" onSubmit={submitCustom}>
            <label htmlFor={customId}>Other</label>
            <input
              id={customId}
              className="timer-input"
              inputMode="decimal"
              autoComplete="off"
              placeholder="min"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
            />
            <button className="btn" type="submit" disabled={busy || !custom.trim()}>
              Start
            </button>
          </form>
          {label && <p className="timer-hint">For “{label}”.</p>}
        </>
      )}
      <PushHint />
    </div>
  );
}

/** Offers alerts for when Helm is closed or the phone is locked, until they're on. */
function PushHint() {
  const [state, setState] = useState<PushState | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void pushState().then(setState);
  }, []);

  if (state === null || state === 'on') return null;
  if (state === 'unsupported') {
    return <p className="timer-hint">Alerts when Helm is closed need the installed app (on iPhone: Add to Home Screen).</p>;
  }
  if (state === 'denied') {
    return <p className="timer-hint">Notifications are blocked for Helm. Allow them in the browser’s site settings to hear timers when the phone is locked.</p>;
  }
  return (
    <p className="timer-hint">
      <button
        className="timer-link"
        onClick={async () => {
          setError(null);
          try {
            setState(await enablePush());
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Couldn’t turn on alerts.');
          }
        }}
      >
        Ring this device when it’s locked
      </button>
      {error && <span className="timer-error"> {error}</span>}
    </p>
  );
}

/** Countdown in the top bar, so a running timer is visible from every view. */
export function TimerChip() {
  const { timer, remaining, due } = useTimerState();
  if (!timer) return null;
  return (
    <a href="#/focus" className={`timer-chip ${due ? 'is-due' : ''} ${timer.status === 'paused' ? 'is-paused' : ''}`} title="Timer">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="13" r="8" fill="none" stroke="currentColor" strokeWidth="2" />
        <path d="M12 9v4l2.5 2M9.5 2.5h5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <span>{due ? 'Time’s up' : formatClock(remaining)}</span>
    </a>
  );
}
