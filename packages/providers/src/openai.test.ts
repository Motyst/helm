import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createProviders, OpenAiLlm, OpenAiStt, ProviderError, toStrictJsonSchema } from './index.ts';

interface Call {
  url: string;
  init: RequestInit;
}

function fakeFetch(respond: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(url), init: init ?? {} };
    calls.push(call);
    return respond(call);
  }) as typeof fetch;
  return { f, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const completion = (content: string, extra: object = {}) =>
  json({ choices: [{ finish_reason: 'stop', message: { content, refusal: null }, ...extra }] });

const Answer = z.object({ title: z.string(), estimate: z.number().int().nullable(), tags: z.array(z.string()) });

async function caught(p: Promise<unknown>): Promise<ProviderError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ProviderError) return e;
    throw e;
  }
  throw new Error('expected a ProviderError');
}

describe('toStrictJsonSchema', () => {
  it('closes objects, requires every key and drops noise', () => {
    const s = toStrictJsonSchema(z.object({ a: z.object({ b: z.number().int() }), c: z.string().nullable() }));
    expect(s).not.toHaveProperty('$schema');
    expect(s).toMatchObject({ type: 'object', additionalProperties: false, required: ['a', 'c'] });
    expect((s.properties as Record<string, unknown>).a).toEqual({
      type: 'object',
      properties: { b: { type: 'integer' } },
      required: ['b'],
      additionalProperties: false,
    });
  });
});

describe('OpenAiLlm', () => {
  it('asks for strict JSON and validates the answer', async () => {
    const { f, calls } = fakeFetch(() => completion('{"title":"Call bank","estimate":15,"tags":[]}'));
    const llm = new OpenAiLlm({ apiKey: 'sk-test', model: 'gpt-test', reasoningEffort: 'low', fetch: f });
    const out = await llm.object({
      system: 'Parse it',
      messages: [{ role: 'user', content: 'call the bank' }],
      schema: Answer,
      name: 'answer',
    });
    expect(out).toEqual({ title: 'Call bank', estimate: 15, tags: [] });

    const call = calls[0]!;
    expect(call.url).toBe('https://api.openai.com/v1/chat/completions');
    expect(new Headers(call.init.headers).get('authorization')).toBe('Bearer sk-test');
    const body = JSON.parse(call.init.body as string);
    expect(body).toMatchObject({
      model: 'gpt-test',
      reasoning_effort: 'low',
      messages: [
        { role: 'system', content: 'Parse it' },
        { role: 'user', content: 'call the bank' },
      ],
      response_format: { type: 'json_schema', json_schema: { name: 'answer', strict: true } },
    });
    expect(body.response_format.json_schema.schema.required).toEqual(['title', 'estimate', 'tags']);
  });

  it('uses a custom base URL and leaves reasoning_effort out by default', async () => {
    const { f, calls } = fakeFetch(() => completion('{"title":"x","estimate":null,"tags":[]}'));
    const llm = new OpenAiLlm({ apiKey: 'k', model: 'm', baseUrl: 'http://localhost:11434/v1/', fetch: f });
    await llm.object({ system: 's', messages: [], schema: Answer, name: 'a' });
    expect(calls[0]!.url).toBe('http://localhost:11434/v1/chat/completions');
    expect(JSON.parse(calls[0]!.init.body as string)).not.toHaveProperty('reasoning_effort');
  });

  it('turns bad answers into bad_output errors', async () => {
    const run = (res: Response) =>
      caught(
        new OpenAiLlm({ apiKey: 'k', model: 'm', fetch: fakeFetch(() => res).f }).object({
          system: 's',
          messages: [],
          schema: Answer,
          name: 'a',
        }),
      );
    expect((await run(completion('not json'))).kind).toBe('bad_output');
    expect((await run(completion('{"title":1}'))).kind).toBe('bad_output');
    expect((await run(completion('{}', { finish_reason: 'length' }))).message).toContain('cut off');
    const refused = await run(json({ choices: [{ message: { content: null, refusal: 'No can do' } }] }));
    expect(refused.message).toBe('OpenAI declined: No can do');
  });

  it('explains HTTP failures without echoing the key', async () => {
    const run = (res: Response) =>
      caught(
        new OpenAiLlm({ apiKey: 'sk-secret-123', model: 'm', fetch: fakeFetch(() => res).f }).object({
          system: 's',
          messages: [],
          schema: Answer,
          name: 'a',
        }),
      );
    const auth = await run(json({ error: { message: 'Incorrect API key provided: sk-secr***123' } }, 401));
    expect(auth).toMatchObject({ kind: 'auth', status: 401 });
    expect(auth.message).not.toContain('sk-');
    expect((await run(json({ error: { code: 'insufficient_quota', message: 'x' } }, 429))).message).toContain('quota');
    expect((await run(json({ error: { message: 'x' } }, 429))).kind).toBe('limit');
    const bad = await run(json({ error: { message: "Unsupported parameter: 'reasoning_effort'" } }, 400));
    expect(bad).toMatchObject({ kind: 'upstream', status: 400 });
    expect(bad.message).toContain('reasoning_effort');
  });

  it('reports timeouts and connection failures as unreachable', async () => {
    const hang = (async (_u: unknown, init?: RequestInit) =>
      new Promise((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
      })) as typeof fetch;
    const slow = await caught(
      new OpenAiLlm({ apiKey: 'k', model: 'm', timeoutMs: 20, fetch: hang }).object({
        system: 's',
        messages: [],
        schema: Answer,
        name: 'a',
      }),
    );
    expect(slow).toMatchObject({ kind: 'unreachable', message: 'Couldn’t reach OpenAI: it took too long to answer.' });

    const down = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch;
    const err = await caught(
      new OpenAiLlm({ apiKey: 'k', model: 'm', fetch: down }).object({ system: 's', messages: [], schema: Answer, name: 'a' }),
    );
    expect(err.message).toBe('Couldn’t reach OpenAI: the connection failed.');
  });
});

describe('OpenAiStt', () => {
  it('uploads the audio as multipart with the model and hints', async () => {
    const { f, calls } = fakeFetch(() => json({ text: '  Call the bank tomorrow. ' }));
    const stt = new OpenAiStt({ apiKey: 'k', model: 'gpt-4o-mini-transcribe', fetch: f });
    const out = await stt.transcribe({
      audio: new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/webm' }),
      filename: 'voice.webm',
      prompt: 'Helm, Garden',
    });
    expect(out).toEqual({ text: 'Call the bank tomorrow.' });
    expect(calls[0]!.url).toBe('https://api.openai.com/v1/audio/transcriptions');
    const form = calls[0]!.init.body as FormData;
    expect(form.get('model')).toBe('gpt-4o-mini-transcribe');
    expect(form.get('prompt')).toBe('Helm, Garden');
    expect(form.get('language')).toBeNull();
    expect((form.get('file') as File).name).toBe('voice.webm');
  });
});

describe('createProviders', () => {
  const base = { llm: { provider: 'openai', model: 'm' }, stt: { provider: 'openai', model: 's' }, openai: {} };

  it('switches features off with a reason when the key is missing', () => {
    const p = createProviders(base);
    expect(p.llm).toBeNull();
    expect(p.stt).toBeNull();
    expect(p.reasons.llm).toContain('OPENAI_API_KEY');
  });

  it('builds adapters from config and rejects unknown names', () => {
    const p = createProviders({ ...base, openai: { apiKey: 'k' }, stt: { provider: 'none', model: '' } });
    expect(p.llm).toMatchObject({ id: 'openai', model: 'm' });
    expect(p.stt).toBeNull();
    expect(p.reasons.stt).toContain('HELM_STT_PROVIDER=none');
    expect(() => createProviders({ ...base, llm: { provider: 'acme', model: 'm' } })).toThrow(
      'HELM_LLM_PROVIDER=acme is not supported. Use one of: none, openai.',
    );
  });
});

describe('OpenAiLlm.chat', () => {
  const sse = (events: unknown[], split = 7) => {
    const text = events.map((e) => `data: ${typeof e === 'string' ? e : JSON.stringify(e)}\n\n`).join('');
    // Deliver in awkward chunks to exercise line buffering.
    const chunks: string[] = [];
    for (let i = 0; i < text.length; i += split) chunks.push(text.slice(i, i + split));
    const enc = new TextEncoder();
    return new Response(
      new ReadableStream({
        start(c) {
          for (const ch of chunks) c.enqueue(enc.encode(ch));
          c.close();
        },
      }),
      { headers: { 'content-type': 'text/event-stream' } },
    );
  };
  const delta = (d: object, finish: string | null = null) => ({ choices: [{ delta: d, finish_reason: finish }] });
  const Proposal = z.object({ summary: z.string(), n: z.number().int() });

  it('streams text and assembles a validated tool call', async () => {
    const { f, calls } = fakeFetch(() =>
      sse([
        delta({ content: 'Hel' }),
        delta({ content: 'lo' }),
        delta({ tool_calls: [{ index: 0, function: { name: 'propose', arguments: '{"summ' } }] }),
        delta({ tool_calls: [{ index: 0, function: { arguments: 'ary":"Two","n":2}' } }] }),
        delta({}, 'tool_calls'),
        '[DONE]',
      ]),
    );
    const llm = new OpenAiLlm({ apiKey: 'k', model: 'm', fetch: f });
    const out = [];
    for await (const c of llm.chat({
      system: 's',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [{ name: 'propose', description: 'd', schema: Proposal }],
    }))
      out.push(c);
    expect(out).toEqual([
      { type: 'text', delta: 'Hel' },
      { type: 'text', delta: 'lo' },
      { type: 'tool', name: 'propose', input: { summary: 'Two', n: 2 } },
    ]);
    const body = JSON.parse(calls[0]!.init.body as string);
    expect(body).toMatchObject({ stream: true, parallel_tool_calls: false });
    expect(body.tools[0].function).toMatchObject({ name: 'propose', strict: true });
    expect(body.tools[0].function.parameters.required).toEqual(['summary', 'n']);
  });

  it('rejects malformed tool calls and mid-stream errors', async () => {
    const run = async (res: Response) => {
      const llm = new OpenAiLlm({ apiKey: 'k', model: 'm', fetch: fakeFetch(() => res).f });
      const gen = llm.chat({ system: 's', messages: [], tools: [{ name: 'propose', description: 'd', schema: Proposal }] });
      return caught(
        (async () => {
          for await (const _ of gen);
        })(),
      );
    };
    const bad = await run(sse([delta({ tool_calls: [{ index: 0, function: { name: 'propose', arguments: '{"n":"x"}' } }] })]));
    expect(bad.kind).toBe('bad_output');
    const err = await run(sse([delta({ content: 'a' }), { error: { message: 'server overloaded' } }]));
    expect(err.message).toBe('OpenAI stopped with an error: server overloaded');
  });
});
