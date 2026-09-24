// The browser's own speech recognition (Web Speech API): the fallback when the server can't
// transcribe. Chrome sends the audio to Google; Safari recognises on the device.

interface Alternative {
  transcript: string;
}
interface Result {
  readonly isFinal: boolean;
  readonly [index: number]: Alternative;
}
interface ResultEvent extends Event {
  readonly results: { readonly length: number; readonly [index: number]: Result };
}
interface ErrorEvent extends Event {
  readonly error: string;
}
interface Recognition extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: ResultEvent) => void) | null;
  onerror: ((e: ErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => Recognition;

function ctor(): RecognitionCtor | null {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const canRecognise = () => ctor() !== null;

export class SpeechError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

export interface Listening {
  /** Stop listening and get everything heard. */
  stop(): Promise<string>;
  cancel(): void;
}

/**
 * Listen until stopped. `onText` gets the running transcript (final and interim words).
 * `onEnd` fires if the browser stops by itself (silence, a network error), with what it heard
 * or a SpeechError.
 */
export function startListening(
  lang: string,
  onText: (text: string) => void,
  onEnd: (result: string | SpeechError) => void,
): Listening {
  const Ctor = ctor();
  if (!Ctor) throw new SpeechError('unsupported');
  const r = new Ctor();
  r.lang = lang;
  r.continuous = true;
  r.interimResults = true;

  let text = '';
  let error: SpeechError | null = null;
  let settle: ((t: string) => void) | null = null;
  let cancelled = false;

  r.onresult = (e) => {
    let all = '';
    for (let i = 0; i < e.results.length; i++) all += e.results[i]![0]!.transcript;
    text = all.replace(/\s+/g, ' ').trim();
    onText(text);
  };
  r.onerror = (e) => {
    // "no-speech" and "aborted" just end the session; the rest are real problems.
    if (e.error !== 'no-speech' && e.error !== 'aborted') error = new SpeechError(e.error);
  };
  r.onend = () => {
    if (cancelled) return;
    if (settle) settle(text);
    else onEnd(error ?? text);
  };
  r.start();

  return {
    stop: () =>
      new Promise<string>((resolve) => {
        settle = resolve;
        r.stop();
      }),
    cancel: () => {
      cancelled = true;
      r.abort();
    },
  };
}
