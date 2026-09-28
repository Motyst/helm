import { useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/api.ts';
import { disablePush, enablePush, pushState, type PushState } from '../../lib/push.ts';

const STATUS: Record<PushState, string> = {
  on: 'On. Timers ring this device even when Helm is closed or the phone is locked.',
  off: 'Off. Timers only ring while Helm is open on this device.',
  denied: 'Blocked. Allow notifications for Helm in this browser’s site settings, then come back here.',
  unsupported:
    'Not available here. Use the installed Helm app (on iPhone: Share → Add to Home Screen) over the secure address.',
};

/** Per-device Web Push switch for timer alerts. */
export function AlertsSection() {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    void pushState().then(setState);
  }, []);

  async function run(fn: () => Promise<PushState | string>) {
    setBusy(true);
    setNote(null);
    try {
      const r = await fn();
      if (r === 'on' || r === 'off' || r === 'denied' || r === 'unsupported') setState(r);
      else setNote(r);
    } catch (err) {
      setNote(err instanceof ApiError || err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="settings-section" aria-labelledby="alerts-heading">
      <h2 id="alerts-heading" className="settings-subtitle">
        Timer alerts
      </h2>
      <p className="field-hint" aria-live="polite">
        {state ? STATUS[state] : 'Checking…'}
      </p>
      {note && <p className="field-hint">{note}</p>}
      <div className="settings-row">
        {state === 'off' && (
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => run(enablePush)}>
            Turn on for this device
          </button>
        )}
        {state === 'on' && (
          <>
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const r = await api.testPush();
                  return r.sent > 0 ? 'Test alert sent. It should arrive in a few seconds.' : 'No device received it.';
                })
              }
            >
              Send a test alert
            </button>
            <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => run(disablePush)}>
              Turn off
            </button>
          </>
        )}
      </div>
    </section>
  );
}
