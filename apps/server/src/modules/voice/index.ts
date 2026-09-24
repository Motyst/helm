import { ProviderError } from '@helm/providers';
import { VoiceTextInput, type VoiceParseResult, type VoiceStatus } from '@helm/shared';
import { bodyLimit } from 'hono/body-limit';
import { forbidden, HelmError, invalid, parse } from '../../core/errors.ts';
import type { Principal } from '../../core/auth/principal.ts';
import type { HelmModule } from '../module.ts';
import { draftTasks } from './parse.ts';

export const MAX_SECONDS = 120;
/** Generous: two minutes of uncompressed mono WAV still fits. OpenAI's own limit is 25 MB. */
export const MAX_BYTES = 15 * 1024 * 1024;

/** Audio types browsers record, mapped to an extension the transcription API recognises. */
const EXTENSIONS: Record<string, string> = {
  'audio/webm': 'webm',
  'video/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'mp4',
  'video/mp4': 'mp4',
  'audio/m4a': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'audio/flac': 'flac',
};

/** Drafting spends the owner's AI credit and exists to add tasks, so read-only tokens can't. */
function assertCanDraft(p: Principal): void {
  if (p.kind === 'token' && p.scope !== 'read_write') throw forbidden('Token is read-only');
}

function validZone(tz: string | undefined): string | undefined {
  if (!tz) return undefined;
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return tz;
  } catch {
    return undefined;
  }
}

/**
 * Voice input: POST audio (or text from the browser's own speech recognition) and get back
 * task suggestions to confirm. Nothing is saved here; the app creates the task after review.
 */
export const voiceModule: HelmModule = {
  name: 'voice',
  register({ api, services, providers }) {
    const { llm, stt, reasons } = providers;

    api.get('/voice', (c) => {
      const status: VoiceStatus = {
        transcribe: stt !== null,
        parse: llm !== null,
        reasons: { transcribe: stt ? undefined : reasons.stt, parse: llm ? undefined : reasons.llm },
        maxSeconds: MAX_SECONDS,
      };
      return c.json(status);
    });

    api.post(
      '/voice/parse',
      bodyLimit({
        maxSize: MAX_BYTES,
        onError: () => {
          throw new HelmError('too_large', `Recordings can be up to ${MAX_SECONDS / 60} minutes long.`);
        },
      }),
      async (c) => {
        const p = c.var.principal;
        assertCanDraft(p);
        const type = (c.req.header('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
        const signal = c.req.raw.signal;
        const projects = services.projects.list(p).map(({ id, name }) => ({ id, name }));

        try {
          let transcript: string;
          if (type === 'application/json') {
            transcript = parse(VoiceTextInput, await c.req.json().catch(() => null)).text;
          } else if (EXTENSIONS[type]) {
            if (!stt) throw new HelmError('unavailable', reasons.stt ?? 'Transcription is off.');
            const audio = await c.req.blob();
            if (audio.size === 0) throw invalid('The recording is empty.');
            const hint = projects.length ? `Projects: ${projects.map((x) => x.name).join(', ')}.` : undefined;
            transcript = (
              await stt.transcribe({
                audio: new Blob([audio], { type }),
                filename: `voice.${EXTENSIONS[type]}`,
                prompt: hint?.slice(0, 800),
                signal,
              })
            ).text;
          } else {
            throw new HelmError(
              'unsupported_media',
              'Send audio (webm, ogg, mp4, m4a, mp3, wav or flac) or JSON {"text": "..."}.',
            );
          }

          transcript = transcript.trim();
          if (!transcript) throw invalid('Didn’t catch any words. Try again a little closer to the mic.');

          const drafted = await draftTasks(llm, transcript, projects, {
            now: new Date(),
            timeZone: validZone(c.req.query('tz')),
            signal,
          });
          const result: VoiceParseResult = { transcript, ...drafted };
          return c.json(result);
        } catch (e) {
          if (e instanceof ProviderError) {
            // Transcription failed. Log the kind only: what was said is private.
            console.warn(`voice: transcription failed (${e.kind}${e.status ? ` ${e.status}` : ''}): ${e.message}`);
            throw new HelmError('upstream', e.message);
          }
          throw e;
        }
      },
    );
  },
};
