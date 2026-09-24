import type { VoiceParseResult } from '@helm/shared';
import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../../lib/api.ts';
import { useVoiceStatus } from '../../lib/queries.ts';
import { canRecord, startRecording, type Recording } from './recorder.ts';
import { canRecognise, SpeechError, startListening, type Listening } from './speech.ts';
import { chooseMode, clock, micErrorMessage, speechErrorMessage } from './voice-model.ts';
import './voice.css';

type Phase =
  | { kind: 'starting' }
  | { kind: 'listening'; since: number }
  | { kind: 'working' }
  | { kind: 'error'; message: string; canRetry: boolean };

const HEADING: Record<Phase['kind'], string> = {
  starting: 'Getting the microphone ready',
  listening: 'Listening',
  working: 'Working out the task',
  error: 'Voice input stopped',
};

const DEFAULT_MAX_SECONDS = 120;

export function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <rect x="8.5" y="3" width="7" height="12" rx="3.5" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path
        d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * Records a spoken task, sends it to the server and hands back suggestions for review.
 * Mounted while open; unmounting stops the microphone and any request in flight.
 */
export function VoiceCapture({
  onResult,
  onClose,
}: {
  onResult: (r: VoiceParseResult) => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const meterRef = useRef<HTMLDivElement>(null);
  const status = useVoiceStatus();
  const [mode] = useState(() =>
    chooseMode(status.data, { secure: window.isSecureContext, canRecord: canRecord(), canRecognise: canRecognise() }),
  );
  const maxSeconds = status.data?.maxSeconds ?? DEFAULT_MAX_SECONDS;

  const [phase, setPhase] = useState<Phase>(
    mode.kind === 'unavailable' ? { kind: 'error', message: mode.reason, canRetry: false } : { kind: 'starting' },
  );
  const [heard, setHeard] = useState('');
  const [now, setNow] = useState(() => Date.now());

  const recording = useRef<Recording | null>(null);
  const listening = useRef<Listening | null>(null);
  const request = useRef<AbortController | null>(null);
  // Bumped by cancel/unmount/retry so late callbacks from an old attempt are ignored.
  const attempt = useRef(0);

  const setLevel = (level: number) => meterRef.current?.style.setProperty('--level', level.toFixed(3));

  function stopAll() {
    attempt.current++;
    recording.current?.cancel();
    recording.current = null;
    listening.current?.cancel();
    listening.current = null;
    request.current?.abort();
    request.current = null;
    setLevel(0);
  }

  async function submit(input: Blob | string, my: number) {
    setPhase({ kind: 'working' });
    const ctrl = new AbortController();
    request.current = ctrl;
    try {
      const result = await api.voiceParse(input, ctrl.signal);
      if (my === attempt.current) onResult(result);
    } catch (e) {
      if (my !== attempt.current || ctrl.signal.aborted) return;
      setPhase({
        kind: 'error',
        message: e instanceof ApiError ? e.message : 'Something went wrong. Try again.',
        canRetry: true,
      });
    }
  }

  function heardNothing() {
    setPhase({ kind: 'error', message: 'Didn’t catch any words. Try again a little closer to the mic.', canRetry: true });
  }

  function onSpeechText(text: string, my: number) {
    if (my !== attempt.current) return;
    listening.current = null;
    if (text) void submit(text, my);
    else heardNothing();
  }

  async function begin() {
    stopAll();
    const my = attempt.current;
    setHeard('');
    setPhase({ kind: 'starting' });

    if (mode.kind === 'record') {
      try {
        const rec = await startRecording(setLevel);
        if (my !== attempt.current) return rec.cancel();
        recording.current = rec;
        setPhase({ kind: 'listening', since: Date.now() });
      } catch (e) {
        if (my === attempt.current) setPhase({ kind: 'error', message: micErrorMessage(e), canRetry: true });
      }
    } else if (mode.kind === 'speech') {
      try {
        listening.current = startListening(
          navigator.language || 'en-US',
          (text) => {
            if (my === attempt.current) setHeard(text);
          },
          (result) => {
            if (my !== attempt.current) return;
            if (result instanceof SpeechError) {
              listening.current = null;
              setPhase({ kind: 'error', message: speechErrorMessage(result.code), canRetry: true });
            } else onSpeechText(result, my);
          },
        );
        setPhase({ kind: 'listening', since: Date.now() });
      } catch (e) {
        setPhase({ kind: 'error', message: micErrorMessage(e), canRetry: true });
      }
    }
  }

  async function finish() {
    const my = attempt.current;
    if (recording.current) {
      const rec = recording.current;
      recording.current = null;
      setLevel(0);
      const blob = await rec.stop();
      if (my !== attempt.current) return;
      if (blob.size === 0) heardNothing();
      else void submit(blob, my);
    } else if (listening.current) {
      const l = listening.current;
      listening.current = null;
      setPhase({ kind: 'working' });
      onSpeechText(await l.stop(), my);
    }
  }

  function cancel() {
    stopAll();
    dialogRef.current?.close();
    onClose();
  }

  useEffect(() => {
    const d = dialogRef.current;
    if (d && !d.open) d.showModal();
    if (mode.kind !== 'unavailable') void begin();
    return stopAll;
    // Runs once per mount; begin/stopAll only touch refs and state setters.
  }, []);

  // Clock while listening; stops at the length limit.
  const listeningSince = phase.kind === 'listening' ? phase.since : null;
  useEffect(() => {
    if (listeningSince === null) return;
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if ((t - listeningSince) / 1000 >= maxSeconds) void finish();
    }, 250);
    return () => clearInterval(id);
  }, [listeningSince, maxSeconds]);

  const elapsed = listeningSince === null ? 0 : (now - listeningSince) / 1000;
  const left = Math.ceil(maxSeconds - elapsed);

  return (
    <dialog
      ref={dialogRef}
      className="voice"
      aria-labelledby="voice-heading"
      onCancel={(e) => {
        e.preventDefault();
        cancel();
      }}
    >
      <div className="voice-body">
        <div ref={meterRef} className={`voice-meter is-${phase.kind} via-${mode.kind}`} aria-hidden>
          <span className="voice-ring" />
          <span className="voice-ring voice-ring-outer" />
          <span className="voice-core">
            <MicIcon />
          </span>
        </div>

        <div className="voice-text">
          {/* Announce phase changes, not the ticking clock. */}
          <h2 id="voice-heading" aria-live="polite">
            {HEADING[phase.kind]}
          </h2>
          {phase.kind === 'listening' && (
            <p className="voice-clock">
              {clock(elapsed)}
              {left <= 30 && <span className="voice-left"> {left} seconds left</span>}
            </p>
          )}
        </div>

        {phase.kind === 'listening' &&
          (heard ? (
            <p className="voice-heard">
              <q>{heard}</q>
            </p>
          ) : (
            <p className="voice-hint">
              Say what needs doing. You can add a project, how urgent it is and how long it takes.
            </p>
          ))}
        {phase.kind === 'working' && heard && (
          <p className="voice-heard">
            <q>{heard}</q>
          </p>
        )}
        {phase.kind === 'error' && (
          <p className="voice-error" role="alert">
            {phase.message}
          </p>
        )}

        <div className="voice-actions">
          <button type="button" className="btn btn-quiet" onClick={cancel}>
            {phase.kind === 'error' ? 'Close' : 'Cancel'}
          </button>
          {phase.kind === 'listening' && (
            <button type="button" className="btn btn-primary" autoFocus onClick={() => void finish()}>
              Done
            </button>
          )}
          {phase.kind === 'error' && phase.canRetry && (
            <button type="button" className="btn btn-primary" autoFocus onClick={() => void begin()}>
              Try again
            </button>
          )}
        </div>
      </div>
    </dialog>
  );
}
