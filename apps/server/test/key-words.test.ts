import { ProviderError, type LlmProvider, type Providers } from '@helm/providers';
import { tasks } from '@helm/db';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.ts';
import { OWNER } from '../src/core/auth/principal.ts';
import { createKeyWordsModule, type KeyWordPicker } from '../src/modules/key-words/index.ts';
import { setup, testConfig } from './helpers.ts';

/** Answers with the given words per title; `null` drops that title from the answer. */
function fakeLlm(pick: (title: string) => string[] | null | Error) {
  const calls: string[][] = [];
  const llm: LlmProvider = {
    id: 'fake',
    model: 'fake-1',
    async object(req) {
      const titles = (req.messages[0]!.content as string).split('\n').map((l) => l.replace(/^\d+\. /, ''));
      calls.push(titles);
      const picks = [];
      for (const [i, t] of titles.entries()) {
        const w = pick(t);
        if (w instanceof Error) throw w;
        if (w) picks.push({ n: i + 1, words: w });
      }
      return req.schema.parse({ picks });
    },
    async *chat() {},
  };
  return { llm, calls };
}

async function makeApp(llm: LlmProvider | null) {
  const env = setup();
  let picker!: KeyWordPicker;
  const providers: Providers = { llm, stt: null, reasons: {} };
  await createApp({
    config: testConfig,
    ctx: env.ctx,
    services: env.services,
    providers,
    modules: [createKeyWordsModule({ delayMs: 60_000, startDelayMs: 60_000, onPicker: (p) => (picker = p) })],
  });
  const keyWords = (id: string) => env.services.tasks.get(OWNER, id).keyWords;
  return { ...env, picker: () => picker, keyWords };
}

describe('key words', () => {
  it('picks them for new tasks, as the title spells them, in one request', async () => {
    const { llm, calls } = fakeLlm((t) => (t.includes('bank') ? ['BANK', 'grok bot'] : ['Georgi', 'Nobody']));
    const { services, picker, keyWords } = await makeApp(llm);
    const a = services.tasks.create(OWNER, { title: 'Connect bank grok bot' });
    const b = services.tasks.create(OWNER, { title: 'Contact Georgi about AI' });
    expect(keyWords(a.id)).toBeNull();
    await picker().settle();
    expect(calls).toHaveLength(1);
    expect(keyWords(a.id)).toEqual(['bank', 'grok bot']);
    expect(keyWords(b.id)).toEqual(['Georgi']);
  });

  it('picks again when the title changes, and leaves Activity alone', async () => {
    const { llm } = fakeLlm((t) => [t.split(' ').at(-1)!]);
    const { services, picker, keyWords } = await makeApp(llm);
    const t = services.tasks.create(OWNER, { title: 'Call the dentist' });
    await picker().settle();
    services.tasks.update(OWNER, t.id, { priority: 'now' });
    await picker().settle();
    expect(keyWords(t.id)).toEqual(['dentist']);

    services.tasks.update(OWNER, t.id, { title: 'Call the plumber' });
    expect(keyWords(t.id)).toBeNull();
    await picker().settle();
    expect(keyWords(t.id)).toEqual(['plumber']);

    const log = services.activity.list(OWNER).entries;
    expect(log.flatMap((e) => e.changes.map((c) => c.action))).not.toContain('keyed');
    // The title change can still be undone after its words were picked, and brings the old ones back.
    const rename = log[0]!;
    expect(rename.cantUndo).toBeNull();
    services.activity.undo(OWNER, rename.batchId);
    expect(services.tasks.get(OWNER, t.id).title).toBe('Call the dentist');
    expect(keyWords(t.id)).toEqual(['dentist']);
  });

  it('skips subtasks and done tasks, and goes through the backlog', async () => {
    const { llm } = fakeLlm(() => null);
    const { services, picker, keyWords, ctx } = await makeApp(llm);
    const parent = services.tasks.create(OWNER, { title: 'Plan the trip to Barcelona' });
    const sub = services.tasks.create(OWNER, { title: 'Book train', parentTaskId: parent.id });
    const done = services.tasks.create(OWNER, { title: 'Buy milk' });
    services.tasks.setStatus(OWNER, done.id, 'done');
    // A title the model skipped falls back to the rule.
    await picker().settle();
    expect(keyWords(parent.id)).toEqual(['Barcelona']);
    expect(keyWords(sub.id)).toBeNull();

    // Tasks from before key words existed get them on start.
    ctx.db.update(tasks).set({ keyWords: null }).run();
    picker().catchUp();
    await picker().settle();
    expect(keyWords(parent.id)).toEqual(['Barcelona']);
    expect(keyWords(sub.id)).toBeNull();
    expect(keyWords(done.id)).toBeNull();
  });

  it('uses the rule without a model, and stops the backlog when the model fails', async () => {
    const { services, picker, keyWords } = await makeApp(null);
    const t = services.tasks.create(OWNER, { title: 'Check davids monetization' });
    await picker().settle();
    expect(keyWords(t.id)).toEqual(['monetization']);

    const broken = fakeLlm(() => new ProviderError('limit', 'Out of credit', 429));
    const env = await makeApp(broken.llm);
    const u = env.services.tasks.create(OWNER, { title: 'Pay rent' });
    await env.picker().settle();
    expect(env.keyWords(u.id)).toBeNull();
    expect(broken.calls).toHaveLength(1);
  });
});
