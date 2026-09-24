import { ProviderError, type LlmProvider, type ObjectRequest, type Providers, type SttProvider } from '@helm/providers';
import type { VoiceParseResult, VoiceStatus } from '@helm/shared';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { createApp } from '../src/app.ts';
import { OWNER } from '../src/core/auth/principal.ts';
import { voiceModule } from '../src/modules/voice/index.ts';
import { systemPrompt } from '../src/modules/voice/parse.ts';
import { setup, testConfig } from './helpers.ts';

type ErrorBody = { error: { code: string; message: string } };

type ModelTask = {
  title: string;
  notes: string | null;
  project: string | null;
  priority: 'now' | 'soon' | 'someday' | null;
  estimateMinutes: number | null;
  subtasks: string[];
};

function fakeLlm(answer: { tasks: ModelTask[] } | Error) {
  const requests: ObjectRequest<z.ZodType>[] = [];
  const llm: LlmProvider = {
    id: 'fake',
    model: 'fake-1',
    async object(req) {
      requests.push(req);
      if (answer instanceof Error) throw answer;
      return req.schema.parse(answer);
    },
    async *chat() {},
  };
  return { llm, requests };
}

function fakeStt(text: string) {
  const calls: { filename: string; type: string; size: number; prompt?: string }[] = [];
  const stt: SttProvider = {
    id: 'fake',
    model: 'fake-stt',
    async transcribe(req) {
      calls.push({ filename: req.filename, type: req.audio.type, size: req.audio.size, prompt: req.prompt });
      return { text };
    },
  };
  return { stt, calls };
}

const task = (t: Partial<ModelTask>): ModelTask => ({
  title: 'x',
  notes: null,
  project: null,
  priority: null,
  estimateMinutes: null,
  subtasks: [],
  ...t,
});

async function makeApp(p: Partial<Providers> = {}) {
  const env = setup();
  const providers: Providers = { llm: null, stt: null, reasons: { llm: 'LLM off', stt: 'STT off' }, ...p };
  const app = await createApp({ config: testConfig, ctx: env.ctx, services: env.services, modules: [voiceModule], providers });
  const rw = env.services.tokens.create(OWNER, { name: 'Phone', scope: 'read_write' }).secret;
  const auth = (secret = rw) => ({ authorization: `Bearer ${secret}` });
  const sendText = (text: string, secret = rw) =>
    app.request('/api/v1/voice/parse?tz=Europe/Riga', {
      method: 'POST',
      headers: { ...auth(secret), 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    });
  const sendAudio = (body: Uint8Array<ArrayBuffer> | string, type = 'audio/webm;codecs=opus') =>
    app.request('/api/v1/voice/parse', { method: 'POST', headers: { ...auth(), 'content-type': type }, body });
  return { ...env, app, auth, sendText, sendAudio };
}

describe('voice status', () => {
  it('says what is available and why not', async () => {
    const { app, auth } = await makeApp({ stt: fakeStt('hi').stt });
    const status = (await (await app.request('/api/v1/voice', { headers: auth() })).json()) as VoiceStatus;
    expect(status).toEqual({ transcribe: true, parse: false, reasons: { parse: 'LLM off' }, maxSeconds: 120 });
  });
});

describe('voice parse', () => {
  it('turns text into cleaned suggestions with projects resolved', async () => {
    const { llm, requests } = fakeLlm({
      tasks: [
        task({
          title: '  Fix   the gutter ',
          notes: '  ',
          project: 'home',
          priority: 'now',
          estimateMinutes: 30,
          subtasks: ['Buy brackets', ' ', 'Ladder'],
        }),
        task({ title: 'Plan trip', project: 'Travel', estimateMinutes: 5000 }),
        task({ title: 'Call mum', project: 'Inbox' }),
        task({ title: '   ' }),
      ],
    });
    const { sendText, services } = await makeApp({ llm });
    const home = services.projects.create(OWNER, { name: 'Home' });
    services.projects.create(OWNER, { name: 'Work' });

    const res = await sendText('fix the gutter now, half an hour...');
    expect(res.status).toBe(200);
    const body = (await res.json()) as VoiceParseResult;
    expect(body.parsed).toBe(true);
    expect(body.transcript).toBe('fix the gutter now, half an hour...');
    expect(body.tasks).toEqual([
      {
        title: 'Fix the gutter',
        notes: null,
        projectId: home.id,
        unmatchedProject: null,
        priority: 'now',
        estimateMinutes: 30,
        subtasks: ['Buy brackets', 'Ladder'],
      },
      {
        title: 'Plan trip',
        notes: null,
        projectId: null,
        unmatchedProject: 'Travel',
        priority: null,
        estimateMinutes: null,
        subtasks: [],
      },
      expect.objectContaining({ title: 'Call mum', projectId: null, unmatchedProject: null }),
    ]);

    const req = requests[0]!;
    expect(req.messages).toEqual([{ role: 'user', content: 'fix the gutter now, half an hour...' }]);
    expect(req.system).toContain('- Home\n- Work');
  });

  it('only offers projects the token can see', async () => {
    const { llm, requests } = fakeLlm({ tasks: [task({ title: 'A' })] });
    const { app, services } = await makeApp({ llm });
    const work = services.projects.create(OWNER, { name: 'Work' });
    services.projects.create(OWNER, { name: 'Secret' });
    const scoped = services.tokens.create(OWNER, { name: 'S', scope: 'read_write', projectIds: [work.id] }).secret;
    await app.request('/api/v1/voice/parse', {
      method: 'POST',
      headers: { authorization: `Bearer ${scoped}`, 'content-type': 'application/json' },
      body: '{"text":"a"}',
    });
    expect(requests[0]!.system).toContain('- Work');
    expect(requests[0]!.system).not.toContain('Secret');
  });

  it('uses the transcript as the title without a model', async () => {
    const { sendText } = await makeApp();
    const body = (await (await sendText('  call   the bank ')).json()) as VoiceParseResult;
    expect(body).toMatchObject({ parsed: false, tasks: [{ title: 'call the bank', priority: null, subtasks: [] }] });
  });

  it('falls back to the transcript when the model finds no task', async () => {
    const { sendText } = await makeApp({ llm: fakeLlm({ tasks: [] }).llm });
    const body = (await (await sendText('hmm')).json()) as VoiceParseResult;
    expect(body).toMatchObject({ parsed: true, tasks: [{ title: 'hmm' }] });
  });

  it('transcribes audio, hinting project names', async () => {
    const { stt, calls } = fakeStt(' Water the plants ');
    const { sendAudio, services } = await makeApp({ stt });
    services.projects.create(OWNER, { name: 'Garden' });
    const res = await sendAudio(new Uint8Array([1, 2, 3, 4]));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ transcript: 'Water the plants', parsed: false });
    expect(calls[0]).toEqual({ filename: 'voice.webm', type: 'audio/webm', size: 4, prompt: 'Projects: Garden.' });

    expect((await sendAudio(new Uint8Array([1]), 'audio/mp4')).status).toBe(200);
    expect(calls[1]!.filename).toBe('voice.mp4');
  });

  it('rejects what it can’t handle', async () => {
    const { sendAudio, sendText, app, auth } = await makeApp({ stt: fakeStt('').stt });
    const empty = await sendAudio(new Uint8Array([1]));
    expect(empty.status).toBe(400);
    expect(((await empty.json()) as ErrorBody).error.message).toContain('Didn’t catch any words');
    expect((await sendAudio(new Uint8Array(0))).status).toBe(400);
    expect((await sendAudio('x', 'image/png')).status).toBe(415);
    expect((await sendText('')).status).toBe(400);

    const big = await app.request('/api/v1/voice/parse', {
      method: 'POST',
      headers: { ...auth(), 'content-type': 'audio/webm', 'content-length': String(16 * 1024 * 1024) },
      body: new Uint8Array(16 * 1024 * 1024),
    });
    expect(big.status).toBe(413);
  });

  it('needs a transcription provider for audio', async () => {
    const { sendAudio } = await makeApp();
    const res = await sendAudio(new Uint8Array([1]));
    expect(res.status).toBe(503);
    expect(((await res.json()) as ErrorBody).error).toEqual({ code: 'unavailable', message: 'STT off' });
  });

  it('keeps the transcript when parsing fails', async () => {
    const { llm } = fakeLlm(new ProviderError('auth', 'OpenAI rejected the API key. Check OPENAI_API_KEY in .env.', 401));
    const { sendText } = await makeApp({ llm });
    const res = await sendText('call the bank');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      parsed: false,
      tasks: [{ title: 'call the bank' }],
      notice: 'Couldn’t fill in the details. OpenAI rejected the API key. Check OPENAI_API_KEY in .env.',
    });
  });

  it('passes transcription failures on as 502 with a readable message', async () => {
    const stt: SttProvider = {
      id: 'fake',
      model: 'x',
      transcribe: async () => {
        throw new ProviderError('unreachable', 'Couldn’t reach OpenAI: the connection failed.');
      },
    };
    const { sendAudio } = await makeApp({ stt });
    const res = await sendAudio(new Uint8Array([1]));
    expect(res.status).toBe(502);
    expect(((await res.json()) as ErrorBody).error).toEqual({
      code: 'upstream',
      message: 'Couldn’t reach OpenAI: the connection failed.',
    });
  });

  it('is closed to read-only tokens and anonymous callers', async () => {
    const { sendText, services, app } = await makeApp();
    const ro = services.tokens.create(OWNER, { name: 'Reader', scope: 'read' }).secret;
    expect((await sendText('x', ro)).status).toBe(403);
    const anon = { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"text":"x"}' };
    expect((await app.request('/api/v1/voice/parse', anon)).status).toBe(401);
  });
});

describe('voice prompt', () => {
  it('states today in the speaker’s zone', () => {
    const now = new Date('2026-09-24T22:30:00Z');
    expect(systemPrompt([], { now, timeZone: 'Europe/Riga' })).toContain('Today is Friday, 25 September 2026.');
    expect(systemPrompt([], { now, timeZone: 'America/New_York' })).toContain('Today is Thursday, 24 September 2026.');
    expect(systemPrompt([], { now, timeZone: 'Not/AZone' })).toContain('(none yet)');
  });
});
