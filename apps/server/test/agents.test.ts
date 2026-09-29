import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { Task } from '@helm/shared';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.ts';
import { ASSISTANT, OWNER } from '../src/core/auth/principal.ts';
import { mcpModule } from '../src/modules/mcp/index.ts';
import { setup, testConfig, token } from './helpers.ts';

const claude = token({ tokenId: 't1', name: 'Claude Code' });
const codex = token({ tokenId: 't2', name: 'Codex' });

describe('notes', () => {
  it('lets agents add to notes but not rewrite or clear them', () => {
    const { services } = setup();
    const t = services.tasks.create(OWNER, { title: 'Fix login', notes: 'Only on Safari' });

    expect(() => services.tasks.update(claude, t.id, { notes: 'Rewritten' })).toThrow(/add to notes/);
    expect(() => services.tasks.update(claude, t.id, { notes: null })).toThrow(/add to notes/);
    // Appending through PATCH is still fine.
    expect(services.tasks.update(claude, t.id, { notes: 'Only on Safari\nand iOS' }).notes).toBe('Only on Safari\nand iOS');

    const noted = services.tasks.appendNote(claude, t.id, { text: '  Found it: cookie SameSite.  ' });
    expect(noted.notes).toBe('Only on Safari\nand iOS\n\n— Claude Code, 2026-09-23: Found it: cookie SameSite.');
    // The owner edits freely.
    expect(services.tasks.update(OWNER, t.id, { notes: null }).notes).toBeNull();
    expect(services.tasks.appendNote(claude, t.id, { text: 'First' }).notes).toBe('— Claude Code, 2026-09-23: First');
  });
});

describe('agent hand-off', () => {
  it('goes ready → working → review → done', () => {
    const { services } = setup();
    const t = services.tasks.create(OWNER, { title: 'Write docs', agentState: 'ready' });
    expect(t.agentState).toBe('ready');

    const claimed = services.tasks.setAgentState(claude, t.id, { state: 'working' });
    expect(claimed).toMatchObject({ agentState: 'working', agentClaimedBy: 'token:Claude Code', status: 'todo' });
    // Claiming again is harmless.
    expect(services.tasks.setAgentState(claude, t.id, { state: 'working' }).agentState).toBe('working');

    const review = services.tasks.setAgentState(claude, t.id, { state: 'review', note: 'See PR 12' });
    expect(review).toMatchObject({ agentState: 'review', agentClaimedBy: 'token:Claude Code' });
    expect(review.notes).toContain('See PR 12');

    const done = services.tasks.complete(OWNER, t.id);
    expect(done).toMatchObject({ status: 'done', agentState: null, agentClaimedBy: null });
  });

  it('stops agents from claiming what isn’t theirs or completing handed-off work', () => {
    const { services } = setup();
    const plain = services.tasks.create(OWNER, { title: 'Personal errand' });
    expect(() => services.tasks.setAgentState(claude, plain.id, { state: 'working' })).toThrow(/ready/);

    const t = services.tasks.create(OWNER, { title: 'Refactor' });
    services.tasks.setAgentState(codex, t.id, { state: 'ready' }); // a sorting agent hands it over
    services.tasks.setAgentState(claude, t.id, { state: 'working' });

    expect(() => services.tasks.setAgentState(codex, t.id, { state: 'working' })).toThrow(/Claude Code is already/);
    expect(() => services.tasks.setAgentState(codex, t.id, { state: 'review' })).toThrow(/Claim the task/);
    expect(() => services.tasks.setAgentState(codex, t.id, { state: null })).toThrow(/Claude Code is working/);
    // A refused step leaves no note behind.
    expect(() => services.tasks.setAgentState(codex, t.id, { state: 'working', note: 'mine now' })).toThrow();
    expect(services.tasks.get(OWNER, t.id).notes).toBeNull();

    expect(() => services.tasks.complete(claude, t.id)).toThrow(/submit it for review/);
    expect(() => services.tasks.update(claude, t.id, { status: 'done' })).toThrow(/submit it for review/);

    const back = services.tasks.setAgentState(claude, t.id, { state: 'ready', note: 'Needs a design decision' });
    expect(back).toMatchObject({ agentState: 'ready', agentClaimedBy: null });
    expect(services.tasks.setAgentState(codex, t.id, { state: 'working' }).agentClaimedBy).toBe('token:Codex');
    // The owner can always take it back.
    expect(services.tasks.update(OWNER, t.id, { agentState: null })).toMatchObject({ agentState: null, agentClaimedBy: null });
  });
});

describe('activity', () => {
  it('groups one request’s changes with the state before each', () => {
    const { services } = setup();
    const t = services.tasks.create(OWNER, { title: 'Ship', subtasks: [{ title: 'Build' }, { title: 'Test' }] });
    services.tasks.complete(claude, t.id);

    const page = services.activity.list(OWNER, { who: 'agents' });
    expect(page.entries).toHaveLength(1);
    const [entry] = page.entries;
    expect(entry!.actor).toBe('token:Claude Code');
    expect(entry!.changes.map((c) => c.action)).toEqual(['completed', 'completed', 'completed']);
    expect((entry!.changes[0]!.before as Task).status).toBe('todo');
    expect((entry!.changes[0]!.after as Task).status).toBe('done');
    expect(entry!.cantUndo).toBeNull();

    const all = services.activity.list(OWNER, {});
    expect(all.entries).toHaveLength(2);
    expect(all.entries[1]!.changes.map((c) => c.before)).toEqual([null, null, null]);
    expect(() => services.activity.list(claude, {})).toThrow(/Owner only/);
  });

  it('undoes a batch and marks it undone', () => {
    const { services } = setup();
    const home = services.projects.create(OWNER, { name: 'Home' });
    const t = services.tasks.create(OWNER, { title: 'Ship', notes: 'keep me', projectId: home.id, subtasks: [{ title: 'Build' }] });
    services.tasks.start(OWNER, t.id);
    services.tasks.complete(claude, t.id);

    const [entry] = services.activity.list(OWNER, { who: 'agents' }).entries;
    services.activity.undo(OWNER, entry!.batchId);

    const back = services.tasks.get(OWNER, t.id);
    expect(back).toMatchObject({ status: 'in_progress', completedAt: null, notes: 'keep me', projectId: home.id });
    expect(services.tasks.subtasks(OWNER, t.id)[0]!.status).toBe('todo');

    const after = services.activity.list(OWNER, {}).entries;
    expect(after[0]!.undoOf).toBe(entry!.batchId);
    expect(after[1]).toMatchObject({ batchId: entry!.batchId, cantUndo: 'Already undone.' });
    expect(after[1]!.undoneAt).not.toBeNull();
    expect(() => services.activity.undo(OWNER, entry!.batchId)).toThrow(/Already undone/);
    // Undoing the undo redoes it.
    services.activity.undo(OWNER, after[0]!.batchId);
    expect(services.tasks.get(OWNER, t.id).status).toBe('done');
  });

  it('undoes a creation, and refuses once something changed since', () => {
    const { services } = setup();
    const made = services.tasks.create(claude, { title: 'Spam' });
    const kept = services.tasks.create(claude, { title: 'Useful' });
    services.tasks.update(OWNER, kept.id, { title: 'Useful, renamed' });

    const entries = services.activity.list(OWNER, {}).entries;
    const createdSpam = entries.find((e) => e.changes[0]!.entityId === made.id)!;
    const createdKept = entries.find((e) => e.changes[0]!.entityId === kept.id && e.changes[0]!.action === 'created')!;
    expect(createdKept.cantUndo).toMatch(/“Useful, renamed” changed after this/);
    expect(() => services.activity.undo(OWNER, createdKept.batchId)).toThrow(/changed after this/);

    services.activity.undo(OWNER, createdSpam.batchId);
    expect(() => services.tasks.get(OWNER, made.id)).toThrow(/not found/);
  });

  it('filters by task and pages', () => {
    const { services } = setup();
    const a = services.tasks.create(OWNER, { title: 'A' });
    for (let i = 0; i < 5; i++) services.tasks.update(ASSISTANT, a.id, { title: `A${i}` });
    services.tasks.create(OWNER, { title: 'B' });

    const first = services.activity.list(OWNER, { taskId: a.id, limit: 4 });
    expect(first.entries).toHaveLength(4);
    expect(first.entries[0]!.actor).toBe('ai:assistant');
    const rest = services.activity.list(OWNER, { taskId: a.id, limit: 4, cursor: first.nextCursor! });
    expect(rest.entries).toHaveLength(2);
    expect(rest.nextCursor).toBeNull();
    expect(rest.entries[1]!.changes[0]!.action).toBe('created');
  });

  it('brings back an archived project and puts a task back in a deleted one’s place in the Inbox', () => {
    const { services } = setup();
    const p = services.projects.create(OWNER, { name: 'Side' });
    const gone = services.projects.create(OWNER, { name: 'Gone' });
    const t = services.tasks.create(OWNER, { title: 'Move me', projectId: gone.id });
    services.tasks.move(claude, t.id, { projectId: null });
    services.projects.archive(OWNER, p.id);

    const entries = services.activity.list(OWNER, {}).entries;
    services.activity.undo(OWNER, entries[0]!.batchId);
    expect(services.projects.get(OWNER, p.id).archivedAt).toBeNull();

    services.projects.remove(OWNER, gone.id);
    const deleted = services.activity.list(OWNER, {}).entries[0]!;
    expect(deleted.cantUndo).toMatch(/deleted project/);
  });
});

describe('MCP agent tools', () => {
  async function connect(name: string, projectIds: string[] | null = null) {
    const env = setup();
    const app = await createApp({ config: testConfig, ctx: env.ctx, services: env.services, modules: [mcpModule] });
    const client = async (n: string) => {
      const c = new Client({ name: 'test', version: '1.0.0' });
      const secret = env.services.tokens.create(OWNER, { name: n, scope: 'read_write', projectIds }).secret;
      await c.connect(
        new StreamableHTTPClientTransport(new URL('http://helm.test/mcp'), {
          requestInit: { headers: { authorization: `Bearer ${secret}` } },
          fetch: async (url, init) => app.request(String(url), init),
        }),
      );
      return c;
    };
    return { ...env, client: await client(name), other: client };
  }
  const text = (r: unknown) => ((r as CallToolResult).content[0] as { text: string }).text;
  const data = (r: unknown) => JSON.parse(text(r));

  it('refuses ambiguous project names instead of guessing', async () => {
    const { client, services } = await connect('Claude');
    services.projects.create(OWNER, { name: 'App' });
    services.projects.create(OWNER, { name: 'Apple' });
    services.projects.create(OWNER, { name: 'Website' });

    const vague = await client.callTool({ name: 'create_task', arguments: { title: 'x', project: 'ap' } });
    expect(vague.isError).toBe(true);
    expect(text(vague)).toContain('"ap" could mean "App" or "Apple"');
    expect(data(await client.callTool({ name: 'create_task', arguments: { title: 'x', project: 'app' } })).project).toBe('App');
    expect(data(await client.callTool({ name: 'create_task', arguments: { title: 'y', project: 'web' } })).project).toBe(
      'Website',
    );
  });

  it('refuses duplicates unless asked', async () => {
    const { client } = await connect('Claude');
    await client.callTool({ name: 'create_task', arguments: { title: 'Renew passport' } });
    const twin = await client.callTool({ name: 'create_task', arguments: { title: '  renew   PASSPORT ' } });
    expect(twin.isError).toBe(true);
    expect(text(twin)).toContain('already exists');
    const forced = await client.callTool({ name: 'create_task', arguments: { title: 'Renew passport', allow_duplicate: true } });
    expect(forced.isError).toBeFalsy();
  });

  it('works a handed-off task end to end without touching the user’s focus', async () => {
    const { client, other, services } = await connect('Claude');
    const mine = services.tasks.create(OWNER, { title: 'Pay rent' });
    services.tasks.start(OWNER, mine.id);
    const t = services.tasks.create(OWNER, { title: 'Update deps', notes: 'Careful with vite', agentState: 'ready' });

    const ready = data(await client.callTool({ name: 'list_tasks', arguments: { agent_state: 'ready' } }));
    expect(ready.map((x: { title: string }) => x.title)).toEqual(['Update deps']);

    expect(data(await client.callTool({ name: 'claim_task', arguments: { id: t.id } }))).toMatchObject({
      agentState: 'working',
      claimedBy: 'Claude',
    });
    const codex = await other('Codex');
    expect(text(await codex.callTool({ name: 'claim_task', arguments: { id: t.id } }))).toContain('Claude is already working');

    await client.callTool({ name: 'add_note', arguments: { id: t.id, text: 'Bumped vite to 8' } });
    const done = await client.callTool({ name: 'complete_task', arguments: { id: t.id } });
    expect(done.isError).toBe(true);
    const handed = data(
      await client.callTool({ name: 'submit_for_review', arguments: { id: t.id, note: 'Branch deps-bump, tests pass' } }),
    );
    expect(handed.agentState).toBe('review');
    expect(handed.notes).toMatch(/^Careful with vite\n\n— Claude, .*Bumped vite to 8\n\n— Claude, .*Branch deps-bump/);

    expect(services.tasks.focus(OWNER).current?.id).toBe(mine.id);
    const tools = (await client.listTools()).tools;
    expect(tools.find((x) => x.name === 'update_task')!.inputSchema.properties).not.toHaveProperty('notes');
  });
});
