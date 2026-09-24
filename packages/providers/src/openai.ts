import type { z } from 'zod';
import { toStrictJsonSchema } from './json-schema.ts';
import {
  ProviderError,
  type ChatChunk,
  type ChatRequest,
  type LlmProvider,
  type ObjectRequest,
  type SttProvider,
  type TranscribeRequest,
} from './types.ts';

export const OPENAI_BASE_URL = 'https://api.openai.com/v1';

export interface OpenAiOptions {
  apiKey: string;
  /** Any OpenAI-compatible API (OpenRouter, Groq, Ollama, LM Studio...). */
  baseUrl?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

export interface OpenAiLlmOptions extends OpenAiOptions {
  model: string;
  /** Sent as `reasoning_effort` for reasoning models (gpt-5, o-series). Omit for others. */
  reasoningEffort?: string;
}

export interface OpenAiSttOptions extends OpenAiOptions {
  model: string;
}

/** Shared HTTP plumbing: auth header, timeout, and error messages that never echo the key. */
class OpenAiHttp {
  readonly baseUrl: string;
  readonly label: string;
  private readonly fetch: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly o: OpenAiOptions) {
    this.baseUrl = (o.baseUrl || OPENAI_BASE_URL).replace(/\/+$/, '');
    this.label = this.baseUrl === OPENAI_BASE_URL ? 'OpenAI' : new URL(this.baseUrl).host;
    this.fetch = o.fetch ?? fetch;
    this.timeoutMs = o.timeoutMs ?? 60_000;
  }

  async post(path: string, body: string | FormData, headers: Record<string, string>, signal?: AbortSignal): Promise<unknown> {
    const res = await this.open(path, body, headers, signal, this.timeoutMs);
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      throw new ProviderError('upstream', `${this.label} sent a response Helm couldn’t read.`, res.status);
    }
  }

  /** Send a request and return the successful response unread (for streaming). */
  async open(
    path: string,
    body: string | FormData,
    headers: Record<string, string>,
    signal: AbortSignal | undefined,
    timeoutMs: number,
  ): Promise<Response> {
    const timeout = AbortSignal.timeout(timeoutMs);
    let res: Response;
    try {
      res = await this.fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${this.o.apiKey}`, ...headers },
        body,
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
    } catch (e) {
      if (signal?.aborted) throw e;
      const why = timeout.aborted ? 'it took too long to answer' : 'the connection failed';
      throw new ProviderError('unreachable', `Couldn’t reach ${this.label}: ${why}.`);
    }
    if (!res.ok) throw this.httpError(res.status, await res.text());
    return res;
  }

  /** Server-sent events from a streaming response, as parsed JSON objects. */
  async *events(res: Response): AsyncGenerator<Record<string, unknown>> {
    const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (value) buffer += value;
      const lines = buffer.split('\n');
      buffer = done ? '' : lines.pop()!;
      for (const line of lines) {
        const data = line.startsWith('data:') ? line.slice(5).trim() : '';
        if (!data || data === '[DONE]') continue;
        let event: Record<string, unknown>;
        try {
          event = JSON.parse(data);
        } catch {
          continue; // keep-alive or partial noise
        }
        const err = event.error as { message?: string } | undefined;
        if (err) throw new ProviderError('upstream', `${this.label} stopped with an error: ${err.message ?? 'unknown'}`);
        yield event;
      }
      if (done) return;
    }
  }

  private httpError(status: number, body: string): ProviderError {
    let vendor: { message?: string; code?: string } = {};
    try {
      vendor = (JSON.parse(body) as { error?: typeof vendor }).error ?? {};
    } catch {
      // not JSON
    }
    if (status === 401 || status === 403) {
      return new ProviderError('auth', `${this.label} rejected the API key. Check OPENAI_API_KEY in .env.`, status);
    }
    if (status === 429) {
      return vendor.code === 'insufficient_quota'
        ? new ProviderError('limit', `Your ${this.label} quota is used up. Check billing on your account.`, status)
        : new ProviderError('limit', `${this.label} is rate limiting requests. Try again in a moment.`, status);
    }
    const detail = vendor.message ? `: ${vendor.message.slice(0, 300)}` : '';
    return new ProviderError('upstream', `${this.label} returned an error (${status})${detail}`, status);
  }
}

interface StreamChunk {
  choices?: {
    finish_reason?: string | null;
    delta?: {
      content?: string | null;
      refusal?: string | null;
      tool_calls?: { index: number; function?: { name?: string; arguments?: string } }[];
    };
  }[];
}

interface ChatCompletion {
  choices?: { finish_reason?: string; message?: { content?: string | null; refusal?: string | null } }[];
}

export class OpenAiLlm implements LlmProvider {
  readonly id = 'openai';
  readonly model: string;
  private readonly http: OpenAiHttp;

  constructor(private readonly o: OpenAiLlmOptions) {
    this.model = o.model;
    this.http = new OpenAiHttp(o);
  }

  async object<S extends z.ZodType>(req: ObjectRequest<S>): Promise<z.output<S>> {
    const body = {
      model: this.model,
      messages: [{ role: 'system', content: req.system }, ...req.messages],
      response_format: {
        type: 'json_schema',
        json_schema: { name: req.name, strict: true, schema: toStrictJsonSchema(req.schema) },
      },
      ...(this.o.reasoningEffort ? { reasoning_effort: this.o.reasoningEffort } : {}),
    };
    const res = (await this.http.post('/chat/completions', JSON.stringify(body), {
      'content-type': 'application/json',
    }, req.signal)) as ChatCompletion;

    const choice = res.choices?.[0];
    const label = this.http.label;
    if (choice?.message?.refusal) throw new ProviderError('bad_output', `${label} declined: ${choice.message.refusal}`);
    if (choice?.finish_reason === 'length') throw new ProviderError('bad_output', `${label}'s answer was cut off.`);
    const content = choice?.message?.content;
    if (!content) throw new ProviderError('bad_output', `${label} sent an empty answer.`);

    let json: unknown;
    try {
      json = JSON.parse(content);
    } catch {
      throw new ProviderError('bad_output', `${label} didn’t answer in the expected format.`);
    }
    const parsed = req.schema.safeParse(json);
    if (!parsed.success) throw new ProviderError('bad_output', `${label} didn’t answer in the expected format.`);
    return parsed.data;
  }

  async *chat(req: ChatRequest): AsyncGenerator<ChatChunk> {
    const tools = req.tools ?? [];
    const body = {
      model: this.model,
      stream: true,
      messages: [{ role: 'system', content: req.system }, ...req.messages],
      ...(tools.length
        ? {
            tools: tools.map((t) => ({
              type: 'function',
              function: { name: t.name, description: t.description, strict: true, parameters: toStrictJsonSchema(t.schema) },
            })),
            parallel_tool_calls: false,
          }
        : {}),
      ...(this.o.reasoningEffort ? { reasoning_effort: this.o.reasoningEffort } : {}),
    };
    // Answers can take a while to finish streaming; allow more than a single request.
    const res = await this.http.open(
      '/chat/completions',
      JSON.stringify(body),
      { 'content-type': 'application/json' },
      req.signal,
      (this.o.timeoutMs ?? 60_000) * 3,
    );

    const label = this.http.label;
    const calls: { name: string; args: string }[] = [];
    let finish: string | null | undefined;
    for await (const event of this.http.events(res)) {
      const choice = (event as StreamChunk).choices?.[0];
      if (!choice) continue;
      const d = choice.delta;
      if (d?.content) yield { type: 'text', delta: d.content };
      if (d?.refusal) yield { type: 'text', delta: d.refusal };
      for (const tc of d?.tool_calls ?? []) {
        const call = (calls[tc.index] ??= { name: '', args: '' });
        if (tc.function?.name) call.name += tc.function.name;
        if (tc.function?.arguments) call.args += tc.function.arguments;
      }
      if (choice.finish_reason) finish = choice.finish_reason;
    }
    if (finish === 'length') throw new ProviderError('bad_output', `${label}'s answer was cut off.`);

    for (const call of calls) {
      const spec = tools.find((t) => t.name === call.name);
      if (!spec) continue;
      let input: unknown;
      try {
        input = JSON.parse(call.args);
      } catch {
        throw new ProviderError('bad_output', `${label} sent a tool call Helm couldn’t read.`);
      }
      const parsed = spec.schema.safeParse(input);
      if (!parsed.success) throw new ProviderError('bad_output', `${label} sent a tool call in the wrong shape.`);
      yield { type: 'tool', name: call.name, input: parsed.data };
    }
  }
}

export class OpenAiStt implements SttProvider {
  readonly id = 'openai';
  readonly model: string;
  private readonly http: OpenAiHttp;

  constructor(o: OpenAiSttOptions) {
    this.model = o.model;
    this.http = new OpenAiHttp(o);
  }

  async transcribe(req: TranscribeRequest): Promise<{ text: string }> {
    const form = new FormData();
    form.set('file', req.audio, req.filename);
    form.set('model', this.model);
    form.set('response_format', 'json');
    if (req.language) form.set('language', req.language);
    if (req.prompt) form.set('prompt', req.prompt);
    // fetch sets the multipart boundary itself.
    const res = (await this.http.post('/audio/transcriptions', form, {}, req.signal)) as { text?: unknown };
    if (typeof res.text !== 'string') {
      throw new ProviderError('bad_output', `${this.http.label} sent a transcription Helm couldn’t read.`);
    }
    return { text: res.text.trim() };
  }
}
