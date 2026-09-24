import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.ts';
import { OWNER } from '../src/core/auth/principal.ts';
import { mcpModule } from '../src/modules/mcp/index.ts';
import { setup, testConfig, token } from './helpers.ts';

function errCode(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return (e as { code?: string }).code;
  }
  return undefined;
}

async function makeApp() {
  const env = setup();
  const app = await createApp({ config: testConfig, ctx: env.ctx, services: env.services, modules: [mcpModule] });
  return { ...env, app };
}

describe('token service', () => {
  it('returns the secret once and stores only a hash', () => {
    const { services, ctx } = setup();
    const { token: t, secret } = services.tokens.create(OWNER, { name: 'Claude Code', scope: 'read_write' });
    expect(secret).toMatch(/^helm_[A-Za-z0-9_-]{43}$/);
    expect(secret.startsWith(t.prefix)).toBe(true);
    expect(JSON.stringify(services.tokens.list(OWNER))).not.toContain(secret);
    const stored = ctx.db.all<{ token_hash: string }>('select token_hash from api_tokens' as never);
    expect(stored[0]?.token_hash).not.toBe(secret);
    expect(stored[0]?.token_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('resolves to a principal until revoked or expired, and tracks last use', () => {
    const { services, clock } = setup();
    const a = services.tokens.create(OWNER, { name: 'A', scope: 'read' });
    const b = services.tokens.create(OWNER, { name: 'B', scope: 'read_write', expiresInDays: 1 });

    expect(services.tokens.resolve(a.secret)).toMatchObject({ kind: 'token', name: 'A', scope: 'read' });
    expect(services.tokens.list(OWNER).find((t) => t.name === 'A')?.lastUsedAt).not.toBeNull();
    expect(services.tokens.resolve('helm_' + 'x'.repeat(43))).toBeNull();
    expect(services.tokens.resolve('garbage')).toBeNull();

    services.tokens.revoke(OWNER, a.token.id);
    expect(services.tokens.resolve(a.secret)).toBeNull();

    expect(services.tokens.resolve(b.secret)).not.toBeNull();
    clock.set('2026-09-26T00:00:00.000Z');
    expect(services.tokens.resolve(b.secret)).toBeNull();
  });

  it('is owner-only, validates projects and keeps active names unique', () => {
    const { services } = setup();
    expect(errCode(() => services.tokens.list(token()))).toBe('forbidden');
    expect(errCode(() => services.tokens.create(token(), { name: 'x', scope: 'read' }))).toBe('forbidden');
    expect(errCode(() => services.tokens.create(OWNER, { name: 'x', scope: 'read', projectIds: ['nope'] }))).toBe(
      'not_found',
    );
    const first = services.tokens.create(OWNER, { name: 'Agent', scope: 'read' });
    expect(errCode(() => services.tokens.create(OWNER, { name: 'Agent', scope: 'read' }))).toBe('conflict');
    services.tokens.revoke(OWNER, first.token.id);
    expect(services.tokens.create(OWNER, { name: 'Agent', scope: 'read' }).token.name).toBe('Agent');
  });

  it('emits token events', () => {
    const { services, published } = setup();
    const { token: t } = services.tokens.create(OWNER, { name: 'A', scope: 'read' });
    services.tokens.revoke(OWNER, t.id);
    expect(published.filter((e) => e.entity === 'token').map((e) => e.action)).toEqual(['created', 'revoked']);
    expect(JSON.stringify(published)).not.toContain('tokenHash');
  });
});

describe('bearer tokens over REST', () => {
  it('authenticates, applies scope and stamps the agent as source', async () => {
    const { app, services } = await makeApp();
    const rw = services.tokens.create(OWNER, { name: 'Claude Code', scope: 'read_write' }).secret;
    const ro = services.tokens.create(OWNER, { name: 'Reader', scope: 'read' }).secret;
    const json = (secret: string) => ({ authorization: `Bearer ${secret}`, 'content-type': 'application/json' });

    const created = await app.request('/api/v1/tasks', {
      method: 'POST',
      headers: json(rw),
      body: JSON.stringify({ title: 'From an agent' }),
    });
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({ source: 'ai:claude-code' });

    const denied = await app.request('/api/v1/tasks', { method: 'POST', headers: json(ro), body: '{"title":"x"}' });
    expect(denied.status).toBe(403);
    expect((await app.request('/api/v1/tasks', { headers: json(ro) })).status).toBe(200);
    // Tokens can't manage tokens.
    expect((await app.request('/api/v1/tokens', { headers: json(rw) })).status).toBe(403);
  });

  it('rejects revoked tokens and closes their live stream', async () => {
    const { app, services } = await makeApp();
    const { token: t, secret } = services.tokens.create(OWNER, { name: 'A', scope: 'read' });
    const res = await app.request('/api/v1/events', { headers: { authorization: `Bearer ${secret}` } });
    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    await reader.read(); // ready

    setTimeout(() => services.tokens.revoke(OWNER, t.id), 20);
    const ended = await Promise.race([
      (async () => {
        for (;;) if ((await reader.read()).done) return true;
      })(),
      new Promise<false>((r) => setTimeout(() => r(false), 2000)),
    ]);
    expect(ended).toBe(true);
    expect((await app.request('/api/v1/tasks', { headers: { authorization: `Bearer ${secret}` } })).status).toBe(401);
  });
});

describe('MCP', () => {
  async function connect(app: Awaited<ReturnType<typeof makeApp>>['app'], secret: string) {
    const client = new Client({ name: 'test', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL('http://helm.test/mcp'), {
      requestInit: { headers: { authorization: `Bearer ${secret}` } },
      fetch: async (url, init) => app.request(String(url), init),
    });
    await client.connect(transport);
    return client;
  }

  const data = (r: unknown) => JSON.parse(((r as CallToolResult).content[0] as { text: string }).text);

  it('requires a valid bearer token', async () => {
    const { app } = await makeApp();
    const res = await app.request('/mcp', { method: 'POST', body: '{}' });
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toContain('Bearer');
  });

  it('offers read tools only to read-only tokens', async () => {
    const { app, services } = await makeApp();
    const ro = await connect(app, services.tokens.create(OWNER, { name: 'Reader', scope: 'read' }).secret);
    const names = (await ro.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual(['get_focus', 'get_task', 'list_done', 'list_projects', 'list_tasks']);
    const rw = await connect(app, services.tokens.create(OWNER, { name: 'Writer', scope: 'read_write' }).secret);
    expect((await rw.listTools()).tools.map((t) => t.name)).toContain('complete_task');
  });

  it('creates, starts and completes tasks through the services', async () => {
    const { app, services } = await makeApp();
    services.projects.create(OWNER, { name: 'Helm' });
    const client = await connect(app, services.tokens.create(OWNER, { name: 'Claude', scope: 'read_write' }).secret);

    const created = data(
      await client.callTool({
        name: 'create_task',
        arguments: { title: 'Write MCP docs', project: 'hel', priority: 'now', subtasks: ['Tools', 'Auth'] },
      }),
    );
    expect(created).toMatchObject({ project: 'Helm', priority: 'now', addedBy: 'ai:claude', progress: '0/2 subtasks done' });

    await client.callTool({ name: 'start_task', arguments: { id: created.id } });
    const focus = data(await client.callTool({ name: 'get_focus', arguments: {} }));
    expect(focus.inProgress.title).toBe('Write MCP docs');

    const done = data(await client.callTool({ name: 'complete_task', arguments: { id: created.id } }));
    expect(done).toMatchObject({ status: 'done', progress: '2/2 subtasks done' });
    const log = data(await client.callTool({ name: 'list_done', arguments: {} }));
    expect(log.tasks.map((t: { title: string }) => t.title)).toEqual(['Write MCP docs']);
  });

  it('returns scope and validation problems as tool errors', async () => {
    const { app, services } = await makeApp();
    const work = services.projects.create(OWNER, { name: 'Work' });
    services.projects.create(OWNER, { name: 'Home' });
    const secret = services.tokens.create(OWNER, { name: 'Scoped', scope: 'read_write', projectIds: [work.id] }).secret;
    const client = await connect(app, secret);

    const home = await client.callTool({ name: 'create_task', arguments: { title: 'x', project: 'Home' } });
    expect(home.isError).toBe(true);
    const inbox = (await client.callTool({ name: 'create_task', arguments: { title: 'x' } })) as CallToolResult;
    expect(inbox.isError).toBe(true);
    expect((inbox.content[0] as { text: string }).text).toContain('forbidden');
    const ok = await client.callTool({ name: 'create_task', arguments: { title: 'x', project: 'Work' } });
    expect(ok.isError).toBeFalsy();
    const projects = data(await client.callTool({ name: 'list_projects', arguments: {} }));
    expect(projects).toEqual([{ id: work.id, name: 'Work', openTasks: 1 }]);
  });
});
