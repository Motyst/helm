import type { VoiceStatus } from '@helm/shared';

export type VoiceMode = { kind: 'record' } | { kind: 'speech' } | { kind: 'unavailable'; reason: string };

export interface Environment {
  secure: boolean;
  canRecord: boolean;
  canRecognise: boolean;
}

/**
 * Record and let the server transcribe when it can; otherwise the browser's own speech
 * recognition. Unknown status (offline, still loading) tries the server.
 */
export function chooseMode(status: VoiceStatus | undefined, env: Environment): VoiceMode {
  if (!env.secure) {
    return {
      kind: 'unavailable',
      reason: 'Voice needs a secure connection. Open Helm over HTTPS, or at localhost on this computer.',
    };
  }
  const serverCanTranscribe = status?.transcribe ?? true;
  if (serverCanTranscribe && env.canRecord) return { kind: 'record' };
  if (env.canRecognise) return { kind: 'speech' };
  if (!serverCanTranscribe) {
    return {
      kind: 'unavailable',
      reason: `${status?.reasons.transcribe ?? 'The server can’t transcribe.'} This browser has no speech recognition of its own either.`,
    };
  }
  return { kind: 'unavailable', reason: 'This browser can’t record audio.' };
}

/** 75 → "1:15" */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Message for a getUserMedia / MediaRecorder failure. */
export function micErrorMessage(e: unknown): string {
  const name = e instanceof DOMException ? e.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Helm can’t use the microphone. Allow microphone access for this site in your browser, then try again.';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No microphone found. Connect one and try again.';
  if (name === 'NotReadableError') return 'The microphone is busy in another app. Close it there and try again.';
  return 'Couldn’t start recording. Try again.';
}

/** Message for a Web Speech error code. */
export function speechErrorMessage(code: string): string {
  if (code === 'not-allowed' || code === 'service-not-allowed') {
    return 'Helm can’t use the microphone. Allow microphone access for this site in your browser, then try again.';
  }
  if (code === 'audio-capture') return 'No microphone found. Connect one and try again.';
  if (code === 'network') return 'The browser’s speech service couldn’t be reached. Check your connection.';
  return 'Speech recognition stopped unexpectedly. Try again.';
}
