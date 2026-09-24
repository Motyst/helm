import { ProviderError, type ChatChunk, type LlmProvider, type ObjectRequest, type Providers } from '@helm/providers';
import type { ApplyResult, ChatStreamEvent, PrioritySuggestion } from '@helm/shared';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { createApp } from '../src/app.ts';
import { ASSISTANT, OWNER } from '../src/core/auth/principal.ts';
import { assistantModule } from '../src/modules/assistant/index.ts';
import { buildSnapshot } from '../src/modules/assistant/snapshot.ts';
import { setup, testConfig, token } from './helpers.ts';

function fakeLlm(o: { answer?: unknown; chat?: (ChatChunk | Error)[] }) {
  const requests: { system: string; messages: unknown[] }[] = [];
  const llm: LlmProvider = {
    id: 'fake',
    model: 'fake-1',
    async object<S extends z.ZodType>(req: ObjectRequest<S>): Promise<z.output<S>> {
      requests.push(req);
      if (o.answer instanceof Error) throw o.answer;
      return req.schema.parse(o.answer) as z.output<S>;
    },
    async *chat(req) {
      requests.push(req);
      for (const c of o.chat ?? []) {
        if (c instanceof Error) throw c;
        yield c;
      }
    },
  };
  return { llm, requests };
}

async function makeApp(llm: LlmProvider | null) {
  const env = setup();
  const providers: Providers = { llm, stt: null, reasons: { llm: 'Assistant needs a key.' } };
  const app = await createApp({ config: testConfig, ctx: env.ctx, services: env.services, modules: [assistantModule], providers });
  // Owner requests go through a session cookie; sign in once.
  const login = await app.request('/api/v1/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: testConfig.ownerPassword }),
  });
  const cookie = login.headers.get('set-cookie')!.split(';')[0]!;
  const post = (path: string, body: unknown = {}) =>
    app.request(`/api/v1${path}`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json', origin: 'http://localhost' },
      body: JSON.stringify(body),
    });
  return { ...env, app, cookie, post };
}

const titles = (tasks: { title: string }[]) => tasks.map((t) => t.title);

describe('arrange', () => {
  it('reorders top-level tasks among their own positions and sets priorities', () => {
    const { services, published } = setup();
    services.tasks.create(OWNER, { title: 'A' });
    const b = services.tasks.create(OWNER, { title: 'B' });
    services.tasks.create(OWNER, { title: 'C' });
    const d = services.tasks.create(OWNER, { title: 'D' });

    services.tasks.arrange(ASSISTANT, { items: [{ id: d.id, priority: 'now' }, { id: b.id }] });
    // D and B swap slots; A and C stay where they were.
    expect(titles(services.tasks.board(OWNER))).toEqual(['A', 'D', 'C', 'B']);
    expect(services.tasks.get(OWNER, d.id).priority).toBe('now');

    const moved = published.filter((e) => e.action === 'moved');
    expect(moved.map((e) => e.actor)).toEqual(['ai:assistant', 'ai:assistant']);
  });

  it('rejects subtasks, duplicates and out-of-scope tasks', () => {
    const { services } = setup();
    const work = services.projects.create(OWNER, { name: 'Work' });
    const p = services.tasks.create(OWNER, { title: 'P', subtasks: [{ title: 's' }] });
    const home = services.tasks.create(OWNER, { title: 'Home' });
    const w = services.tasks.create(OWNER, { title: 'W', projectId: work.id });
    const sub = services.tasks.board(OWNER).find((t) => t.parentTaskId === p.id)!;
    const code = (fn: () => unknown) => {
      try {
        fn();
      } catch (e) {
        return (e as { code?: string }).code;
      }
    };
    expect(code(() => services.tasks.arrange(OWNER, { items: [{ id: sub.id }] }))).toBe('invalid');
    expect(code(() => services.tasks.arrange(OWNER, { items: [{ id: p.id }, { id: p.id }] }))).toBe('invalid');
    const scoped = token({ projectIds: [work.id] });
    expect(code(() => services.tasks.arrange(scoped, { items: [{ id: w.id }, { id: home.id }] }))).toBe('forbidden');
  });

  it('records assistant-created tasks as ai:assistant', () => {
    const { services } = setup();
    expect(services.tasks.create(ASSISTANT, { title: 'x' }).source).toBe('ai:assistant');
  });
});

describe('snapshot', () => {
  it('lists open tasks with short refs, subtasks and recent done work', () => {
    const { services } = setup();
    const work = services.projects.create(OWNER, { name: 'Work' });
    const a = services.tasks.create(OWNER, { title: 'Write report', projectId: work.id, priority: 'now', notes: 'Due Friday' });
    services.tasks.create(OWNER, { title: 'Outline', parentTaskId: a.id });
    const done = services.tasks.create(OWNER, { title: 'Old thing' });
    services.tasks.complete(OWNER, done.id);
    services.tasks.start(OWNER, a.id);
    const now = new Date('2026-09-23T12:00:00Z');
    const s = buildSnapshot(services.tasks.board(OWNER), services.projects.list(OWNER), services.tasks.doneLog(OWNER).tasks, now);
    expect(s.text).toContain('- t1: Write report; project Work; priority now; IN PROGRESS');
    expect(s.text).toContain('  notes: Due Friday');
    expect(s.text).toContain('  - t2 (subtask, open): Outline');
    expect(s.text).toContain('- Old thing (Inbox, done');
    expect(s.refs.get('t1')?.id).toBe(a.id);
    expect(s.open.map((t) => t.title)).toEqual(['Write report']);
  });
});

describe('assistant routes', () => {
  it('suggests an order, dropping bad refs and keeping forgotten tasks', async () => {
    const { llm, requests } = fakeLlm({
      answer: {
        summary: 'Start with the report.',
        order: [
          { ref: 't2', priority: 'now', reason: '  Due   Friday ' },
          { ref: 't9', priority: 'now', reason: 'invented' },
          { ref: 't2', priority: 'soon', reason: 'duplicate' },
        ],
      },
    });
    const { post, services } = await makeApp(llm);
    const a = services.tasks.create(OWNER, { title: 'A', priority: 'someday' });
    const b = services.tasks.create(OWNER, { title: 'B' });

    const res = await post('/assistant/prioritize?tz=Europe/Riga');
    expect(res.status).toBe(200);
    const body = (await res.json()) as PrioritySuggestion;
    expect(body).toEqual({
      summary: 'Start with the report.',
      items: [
        { taskId: b.id, priority: 'now', reason: 'Due Friday' },
        { taskId: a.id, priority: 'someday', reason: null },
      ],
    });
    expect(requests[0]!.system).toContain('- t1: A; project Inbox; priority someday');
  });

  it('streams chat text and a proposal with real ids', async () => {
    const { llm } = fakeLlm({
      chat: [
        { type: 'text', delta: 'Proposed ' },
        { type: 'text', delta: 'two changes.' },
        {
          type: 'tool',
          name: 'propose_changes',
          input: {
            summary: 'Split and start',
            changes: [
              { action: 'create', ref: null, title: 'Draft intro', notes: null, project: null, priority: null, estimateMinutes: 20, parentRef: 't1', subtasks: [] },
              { action: 'start', ref: 't1', title: null, notes: null, project: null, priority: null, estimateMinutes: null, parentRef: null, subtasks: [] },
              { action: 'update', ref: 't1', title: null, notes: null, project: 'work', priority: 'now', estimateMinutes: null, parentRef: null, subtasks: [] },
              { action: 'complete', ref: 't42', title: null, notes: null, project: null, priority: null, estimateMinutes: null, parentRef: null, subtasks: [] },
              { action: 'create', ref: null, title: '  ', notes: null, project: null, priority: null, estimateMinutes: null, parentRef: null, subtasks: [] },
            ],
          },
        },
      ],
    });
    const { post, services } = await makeApp(llm);
    const work = services.projects.create(OWNER, { name: 'Work' });
    const report = services.tasks.create(OWNER, { title: 'Report' });

    const res = await post('/assistant/chat', { messages: [{ role: 'user', content: 'Break down the report' }] });
    expect(res.headers.get('content-type')).toContain('application/x-ndjson');
    const events = (await res.text())
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as ChatStreamEvent);
    expect(events).toEqual([
      { type: 'text', delta: 'Proposed ' },
      { type: 'text', delta: 'two changes.' },
      {
        type: 'proposal',
        summary: 'Split and start',
        changes: [
          { action: 'create', title: 'Draft intro', estimateMinutes: 20, parentTaskId: report.id },
          { action: 'start', taskId: report.id },
          { action: 'update', taskId: report.id, projectId: work.id, priority: 'now' },
        ],
      },
      { type: 'done' },
    ]);
  });

  it('reports provider failures inside the stream', async () => {
    const { llm } = fakeLlm({ chat: [{ type: 'text', delta: 'Hm' }, new ProviderError('limit', 'Rate limited.')] });
    const { post } = await makeApp(llm);
    const res = await post('/assistant/chat', { messages: [{ role: 'user', content: 'hi' }] });
    expect((await res.text()).trim().split('\n').map((l) => JSON.parse(l))).toEqual([
      { type: 'text', delta: 'Hm' },
      { type: 'error', message: 'Rate limited.' },
    ]);
  });

  it('applies accepted changes as the assistant, one result each', async () => {
    const { post, services, published } = await makeApp(fakeLlm({}).llm);
    const a = services.tasks.create(OWNER, { title: 'A' });
    const b = services.tasks.create(OWNER, { title: 'B' });
    const before = published.length;

    const res = await post('/assistant/apply', {
      changes: [
        { action: 'create', title: 'New', priority: 'now', subtasks: ['one'] },
        { action: 'complete', taskId: a.id },
        { action: 'update', taskId: 'missing', title: 'x' },
        { action: 'arrange', items: [{ id: b.id, priority: 'someday' }] },
      ],
    });
    const body = (await res.json()) as ApplyResult;
    expect(body.results).toEqual([{ ok: true }, { ok: true }, { ok: false, error: 'Task not found' }, { ok: true }]);
    const created = services.tasks.board(OWNER).find((t) => t.title === 'New')!;
    expect(created.source).toBe('ai:assistant');
    expect(services.tasks.get(OWNER, a.id).status).toBe('done');
    expect(services.tasks.get(OWNER, b.id).priority).toBe('someday');
    expect(new Set(published.slice(before).map((e) => e.actor))).toEqual(new Set(['ai:assistant']));

    // Deleting isn't something the assistant can do.
    expect((await post('/assistant/apply', { changes: [{ action: 'delete', taskId: b.id }] })).status).toBe(400);
  });

  it('is owner only and explains when no model is set up', async () => {
    const { app, services } = await makeApp(fakeLlm({}).llm);
    const secret = services.tokens.create(OWNER, { name: 'Agent', scope: 'read_write' }).secret;
    const res = await app.request('/api/v1/assistant/prioritize', {
      method: 'POST',
      headers: { authorization: `Bearer ${secret}` },
    });
    expect(res.status).toBe(403);

    const off = await makeApp(null);
    const status = await off.app.request('/api/v1/assistant', { headers: { cookie: off.cookie } });
    expect(await status.json()).toEqual({ available: false, reason: 'Assistant needs a key.' });
    expect((await off.post('/assistant/prioritize')).status).toBe(503);
  });
});
