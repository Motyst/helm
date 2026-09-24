import type { VoiceStatus } from '@helm/shared';
import { describe, expect, it } from 'vitest';
import { pickMimeType } from './recorder.ts';
import { chooseMode, clock } from './voice-model.ts';

const status = (transcribe: boolean): VoiceStatus => ({
  transcribe,
  parse: true,
  reasons: transcribe ? {} : { transcribe: 'Transcription needs an OpenAI key.' },
  maxSeconds: 120,
});
const env = { secure: true, canRecord: true, canRecognise: true };

describe('chooseMode', () => {
  it('records for the server when it can transcribe', () => {
    expect(chooseMode(status(true), env)).toEqual({ kind: 'record' });
    // Status not loaded yet (offline): try the server.
    expect(chooseMode(undefined, env)).toEqual({ kind: 'record' });
  });

  it('falls back to the browser’s recognition', () => {
    expect(chooseMode(status(false), env)).toEqual({ kind: 'speech' });
    expect(chooseMode(status(true), { ...env, canRecord: false })).toEqual({ kind: 'speech' });
  });

  it('explains why voice is unavailable', () => {
    expect(chooseMode(status(true), { ...env, secure: false })).toMatchObject({
      kind: 'unavailable',
      reason: expect.stringContaining('HTTPS'),
    });
    expect(chooseMode(status(false), { ...env, canRecognise: false })).toEqual({
      kind: 'unavailable',
      reason: 'Transcription needs an OpenAI key. This browser has no speech recognition of its own either.',
    });
    expect(chooseMode(status(true), { ...env, canRecord: false, canRecognise: false })).toMatchObject({
      reason: 'This browser can’t record audio.',
    });
  });
});

describe('helpers', () => {
  it('formats a clock', () => {
    expect(clock(0)).toBe('0:00');
    expect(clock(75.9)).toBe('1:15');
    expect(clock(120)).toBe('2:00');
  });

  it('prefers webm, then mp4 (Safari)', () => {
    expect(pickMimeType(() => true)).toBe('audio/webm;codecs=opus');
    expect(pickMimeType((t) => t === 'audio/mp4')).toBe('audio/mp4');
    expect(pickMimeType(() => false)).toBeUndefined();
  });
});
