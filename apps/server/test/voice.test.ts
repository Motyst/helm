import { ProviderError, type LlmProvider, type ObjectRequest, type Providers, type SttProvider } from '@helm/providers';
import type { VoiceParseResult, VoiceStatus } from '@helm/shared';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { createApp } from '../src/app.ts';
import { OWNER } from '../src/core/auth/principal.ts';
import { voiceModule } from '../src/modules/voice/index.ts';
import { clean, shorten, systemPrompt, TITLE_MAX } from '../src/modules/voice/parse.ts';
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
        task({ title: 'Email Sam', project: 'o' }),
      ],
    });
    const { sendText, services } = await makeApp({ llm });
    const home = services.projects.create(OWNER, { name: 'Home' });
    const work = services.projects.create(OWNER, { name: 'Work' });

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
        projectChoices: [],
        priority: 'now',
        estimateMinutes: 30,
        subtasks: ['Buy brackets', 'Ladder'],
        today: null,
      },
      {
        title: 'Plan trip',
        notes: null,
        projectId: null,
        unmatchedProject: 'Travel',
        projectChoices: [],
        priority: null,
        estimateMinutes: null,
        subtasks: [],
        today: null,
      },
      expect.objectContaining({ title: 'Call mum', projectId: null, unmatchedProject: null }),
      // Fits two projects: no guess, the user picks.
      expect.objectContaining({
        title: 'Email Sam',
        projectId: null,
        unmatchedProject: null,
        projectChoices: [
          { id: home.id, name: 'Home' },
          { id: work.id, name: 'Work' },
        ],
      }),
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

  it('files tasks under the label said at the end', async () => {
    const { llm, requests } = fakeLlm({
      tasks: [
        task({ title: 'Buy milk', project: 'Work', priority: 'now' }),
        task({ title: 'Fix the tap', project: 'Work', priority: 'someday' }),
      ],
    });
    const { sendText, services } = await makeApp({ llm });
    const home = services.projects.create(OWNER, { name: 'Home' });
    const work = services.projects.create(OWNER, { name: 'Work' });

    const body = (await (await sendText('Buy milk for work, urgent. Fix the tap. Home, soon.')).json()) as VoiceParseResult;
    // The label is kept from the model, wins for the last task, and leaves the others as said.
    expect(requests[0]!.messages).toEqual([{ role: 'user', content: 'Buy milk for work, urgent. Fix the tap' }]);
    expect(body.transcript).toBe('Buy milk for work, urgent. Fix the tap. Home, soon.');
    expect(body.tasks).toMatchObject([
      { title: 'Buy milk', projectId: work.id, priority: 'now' },
      { title: 'Fix the tap', projectId: home.id, priority: 'soon' },
    ]);
  });

  it('fills in from the label where the model left it open', async () => {
    const { llm } = fakeLlm({ tasks: [task({ title: 'A' }), task({ title: 'B', project: 'Hom' })] });
    const { sendText, services } = await makeApp({ llm });
    const home = services.projects.create(OWNER, { name: 'Home' });
    services.projects.create(OWNER, { name: 'Homework' });
    const body = (await (await sendText('a and b. Inbox, now.')).json()) as VoiceParseResult;
    expect(body.tasks).toMatchObject([
      { title: 'A', projectId: null, priority: 'now' },
      { title: 'B', projectId: null, projectChoices: [], priority: 'now' },
    ]);
    expect(home.id).toBeTruthy();
  });

  it('puts a task on Today when the recording ends with “today”', async () => {
    const { sendText } = await makeApp();
    const side = ((await (await sendText('Call the bank today')).json()) as VoiceParseResult).tasks[0]!;
    expect(side).toMatchObject({ title: 'Call the bank', today: 'side' });
    const main = ((await (await sendText('Finish the budget draft. Soon, today, main.')).json()) as VoiceParseResult).tasks[0]!;
    expect(main).toMatchObject({ title: 'Finish the budget draft', today: 'main', priority: 'soon' });
  });

  it('reads the label without a model too', async () => {
    const { sendText, services } = await makeApp();
    const home = services.projects.create(OWNER, { name: 'Home' });
    const body = (await (await sendText('Water the plants. Home, someday.')).json()) as VoiceParseResult;
    expect(body).toMatchObject({ parsed: false, tasks: [{ title: 'Water the plants', projectId: home.id, priority: 'someday' }] });
  });

  it('uses the transcript as the title without a model', async () => {
    const { sendText } = await makeApp();
    const body = (await (await sendText('  call   the bank ')).json()) as VoiceParseResult;
    expect(body).toMatchObject({ parsed: false, tasks: [{ title: 'call the bank', priority: null, subtasks: [] }] });
  });

  it('keeps a long recording out of the title without a model', async () => {
    const { sendText } = await makeApp();
    const said =
      'Call the bank about the mortgage. Ask whether we can move the payment date to the fifth, and whether the fee goes away if we do it before October.';
    const [t] = ((await (await sendText(said)).json()) as VoiceParseResult).tasks;
    expect(t).toMatchObject({ title: 'Call the bank about the mortgage.', notes: said });
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

describe('concise drafts', () => {
  it('cuts long titles at a word and keeps the rest in the notes', () => {
    const long = 'Add a link on each social media profile that is specific to that platform so people land on the right page';
    expect(shorten('Short one')).toBe('Short one');
    const cut = shorten(long);
    expect(cut.length).toBeLessThanOrEqual(TITLE_MAX);
    expect(cut).toMatch(/^Add a link on each social media profile .*\S…$/);

    const t = clean(task({ title: long, notes: 'Instagram first' }), [])!;
    expect(t.title).toBe(cut);
    expect(t.notes).toBe(`${long}\n\nInstagram first`);
    expect(clean(task({ title: 'Fix gutter', notes: '  ' }), [])!.notes).toBeNull();
  });

  it('asks the model to condense', () => {
    const prompt = systemPrompt([], { now: new Date('2026-09-29T10:00:00Z') });
    expect(prompt).toContain('3 to 8 words, at most 60 characters');
    expect(prompt).toContain("Summarise, don't transcribe");
  });

  it('asks the model to file by topic and to read an end label', () => {
    const prompt = systemPrompt([], { now: new Date('2026-09-29T10:00:00Z') });
    expect(prompt).toContain('plainly belongs to one of them by its topic');
    expect(prompt).toContain('Speakers often end with a label');
  });
});
