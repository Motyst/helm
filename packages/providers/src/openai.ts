import type { z } from 'zod';
import { toStrictJsonSchema } from './json-schema.ts';
import { ProviderError, type LlmProvider, type ObjectRequest, type SttProvider, type TranscribeRequest } from './types.ts';

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
    const timeout = AbortSignal.timeout(this.timeoutMs);
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
    const text = await res.text();
    if (!res.ok) throw this.httpError(res.status, text);
    try {
      return JSON.parse(text);
    } catch {
      throw new ProviderError('upstream', `${this.label} sent a response Helm couldn’t read.`, res.status);
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
