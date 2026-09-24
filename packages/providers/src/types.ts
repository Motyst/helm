import type { z } from 'zod';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ObjectRequest<S extends z.ZodType> {
  /** Instructions for the model. */
  system: string;
  messages: ChatMessage[];
  /** Shape of the answer. Keep it plain: no optional keys, no defaults. Constraints are checked after. */
  schema: S;
  /** Short identifier for the schema, e.g. `task_drafts`. */
  name: string;
  signal?: AbortSignal;
}

/** A function the model may call. Its input is validated against `schema` before it's yielded. */
export interface ToolSpec {
  name: string;
  description: string;
  /** Same rules as ObjectRequest.schema. */
  schema: z.ZodType;
}

export interface ChatRequest {
  system: string;
  messages: ChatMessage[];
  tools?: ToolSpec[];
  signal?: AbortSignal;
}

export type ChatChunk =
  /** More of the answer text. */
  | { type: 'text'; delta: string }
  /** A complete, validated tool call. */
  | { type: 'tool'; name: string; input: unknown };

/** A chat model. Adapters turn this into one vendor's API. */
export interface LlmProvider {
  /** Adapter id, e.g. `openai`. */
  readonly id: string;
  readonly model: string;
  /** Ask for a JSON answer matching `schema`; the result is validated before it's returned. */
  object<S extends z.ZodType>(req: ObjectRequest<S>): Promise<z.output<S>>;
  /** Stream an answer. Tool calls arrive whole, after their arguments finish streaming. */
  chat(req: ChatRequest): AsyncIterable<ChatChunk>;
}

export interface TranscribeRequest {
  audio: Blob;
  /** File name with an extension the vendor recognises, e.g. `voice.webm`. */
  filename: string;
  /** ISO-639-1 hint. Omit to auto-detect. */
  language?: string;
  /** Words likely to appear (project names...), to help spelling. */
  prompt?: string;
  signal?: AbortSignal;
}

/** Speech to text. */
export interface SttProvider {
  readonly id: string;
  readonly model: string;
  transcribe(req: TranscribeRequest): Promise<{ text: string }>;
}

export type ProviderErrorKind =
  /** Key missing or rejected. */
  | 'auth'
  /** Rate limit or quota. */
  | 'limit'
  /** Timed out or couldn't connect. */
  | 'unreachable'
  /** The model declined or answered in the wrong shape. */
  | 'bad_output'
  /** Anything else the vendor returned. */
  | 'upstream';

/** Errors from a provider, with a message safe to show the user (never includes the key). */
export class ProviderError extends Error {
  constructor(
    readonly kind: ProviderErrorKind,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}
