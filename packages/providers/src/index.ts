import { OpenAiLlm, OpenAiStt } from './openai.ts';
import type { LlmProvider, SttProvider } from './types.ts';

export * from './types.ts';
export { OpenAiLlm, OpenAiStt, OPENAI_BASE_URL } from './openai.ts';
export { toStrictJsonSchema } from './json-schema.ts';

export interface ProviderConfig {
  /** Adapter name, or `none` to turn the feature off. */
  llm: { provider: string; model: string; reasoningEffort?: string };
  stt: { provider: string; model: string };
  openai: { apiKey?: string; baseUrl?: string };
}

/** What's available. A null slot carries `reason`, a sentence for the user or the server log. */
export interface Providers {
  llm: LlmProvider | null;
  stt: SttProvider | null;
  reasons: { llm?: string; stt?: string };
}

type Built<T> = T | { off: string };

/** Adapter factories. Adding a vendor = one entry here plus its adapter file. */
const LLM: Record<string, (c: ProviderConfig, f?: typeof fetch) => Built<LlmProvider>> = {
  none: () => ({ off: 'AI parsing is turned off (HELM_LLM_PROVIDER=none).' }),
  openai: (c, f) =>
    c.openai.apiKey
      ? new OpenAiLlm({ ...c.openai, apiKey: c.openai.apiKey, ...c.llm, fetch: f })
      : { off: 'AI parsing needs an OpenAI key. Set OPENAI_API_KEY in .env and restart Helm.' },
};

const STT: Record<string, (c: ProviderConfig, f?: typeof fetch) => Built<SttProvider>> = {
  none: () => ({ off: 'Server transcription is turned off (HELM_STT_PROVIDER=none).' }),
  openai: (c, f) =>
    c.openai.apiKey
      ? new OpenAiStt({ ...c.openai, apiKey: c.openai.apiKey, model: c.stt.model, fetch: f })
      : { off: 'Transcription needs an OpenAI key. Set OPENAI_API_KEY in .env and restart Helm.' },
};

export const LLM_PROVIDERS = Object.keys(LLM);
export const STT_PROVIDERS = Object.keys(STT);

export function createProviders(c: ProviderConfig, fetchImpl?: typeof fetch): Providers {
  const llm = pick(LLM, 'HELM_LLM_PROVIDER', c.llm.provider)(c, fetchImpl);
  const stt = pick(STT, 'HELM_STT_PROVIDER', c.stt.provider)(c, fetchImpl);
  return {
    llm: 'off' in llm ? null : llm,
    stt: 'off' in stt ? null : stt,
    reasons: { llm: 'off' in llm ? llm.off : undefined, stt: 'off' in stt ? stt.off : undefined },
  };
}

/** Nothing configured; for tests and API-only setups. */
export const NO_PROVIDERS: Providers = {
  llm: null,
  stt: null,
  reasons: { llm: 'No AI provider configured.', stt: 'No speech-to-text provider configured.' },
};

function pick<T>(table: Record<string, T>, env: string, name: string): T {
  const f = table[name];
  if (!f) throw new Error(`${env}=${name} is not supported. Use one of: ${Object.keys(table).join(', ')}.`);
  return f;
}
