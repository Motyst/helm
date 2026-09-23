import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.ts';
import { setup, testConfig, token } from './helpers.ts';

async function makeApp() {
  const env = setup();
  const app = await createApp({
    config: testConfig,
    ctx: env.ctx,
    services: env.services,
    resolveToken: (t) => (t === 'good-token' ? token({ scope: 'read' }) : null),
  });
  return { ...env, app };
}

async function login(app: Awaited<ReturnType<typeof makeApp>>['app']): Promise<string> {
  const res = await app.request('/api/v1/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: testConfig.ownerPassword }),
  });
  expect(res.status).toBe(200);
  return res.headers.get('set-cookie')!.split(';')[0]!;
}

describe('auth', () => {
  it('rejects unauthenticated requests', async () => {
    const { app } = await makeApp();
    const res = await app.request('/api/v1/tasks');
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: 'unauthorized' } });
  });

  it('rejects a wrong password', async () => {
    const { app } = await makeApp();
    const res = await app.request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'nope' }),
    });
    expect(res.status).toBe(401);
  });

  it('logs in with a session cookie', async () => {
    const { app } = await makeApp();
    const cookie = await login(app);
    const me = await app.request('/api/v1/auth/me', { headers: { cookie } });
    expect(await me.json()).toEqual({ signedIn: true });
    expect((await app.request('/api/v1/tasks', { headers: { cookie } })).status).toBe(200);
  });

  it('rejects a tampered cookie', async () => {
    const { app } = await makeApp();
    const res = await app.request('/api/v1/tasks', { headers: { cookie: 'helm_session=v1.1234.fake' } });
    expect(res.status).toBe(401);
  });

  it('accepts bearer tokens and enforces their scope', async () => {
    const { app } = await makeApp();
    const auth = { authorization: 'Bearer good-token' };
    expect((await app.request('/api/v1/tasks', { headers: auth })).status).toBe(200);
    const res = await app.request('/api/v1/tasks', {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'x' }),
    });
    expect(res.status).toBe(403);
    expect((await app.request('/api/v1/tasks', { headers: { authorization: 'Bearer bad' } })).status).toBe(401);
  });

  it('blocks cross-site form posts', async () => {
    const { app } = await makeApp();
    const cookie = await login(app);
    const res = await app.request('http://localhost/api/v1/tasks', {
      method: 'POST',
      headers: { cookie, origin: 'https://evil.example', 'content-type': 'application/x-www-form-urlencoded' },
      body: 'title=x',
    });
    expect(res.status).toBe(403);
  });
});

describe('tasks API', () => {
  it('creates, starts and completes a task; focus follows', async () => {
    const { app } = await makeApp();
    const cookie = await login(app);
    const json = { cookie, 'content-type': 'application/json' };

    const created = await app.request('/api/v1/tasks', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ title: 'Ship Helm', priority: 'now', estimateMinutes: 45 }),
    });
    expect(created.status).toBe(201);
    const task = (await created.json()) as { id: string };

    await app.request(`/api/v1/tasks/${task.id}/start`, { method: 'POST', headers: json });
    let focus = (await (await app.request('/api/v1/focus', { headers: { cookie } })).json()) as {
      current: { id: string } | null;
    };
    expect(focus.current?.id).toBe(task.id);

    await app.request(`/api/v1/tasks/${task.id}/complete`, { method: 'POST', headers: json });
    focus = (await (await app.request('/api/v1/focus', { headers: { cookie } })).json()) as typeof focus;
    expect(focus.current).toBeNull();

    const done = (await (await app.request('/api/v1/done', { headers: { cookie } })).json()) as unknown[];
    expect(done).toHaveLength(1);
  });

  it('maps errors to status codes', async () => {
    const { app } = await makeApp();
    const cookie = await login(app);
    const json = { cookie, 'content-type': 'application/json' };

    const bad = await app.request('/api/v1/tasks', { method: 'POST', headers: json, body: '{nope' });
    expect(bad.status).toBe(400);

    const invalid = await app.request('/api/v1/tasks', { method: 'POST', headers: json, body: '{"title":""}' });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ error: { code: 'invalid', details: [{ path: 'title' }] } });

    expect((await app.request('/api/v1/tasks/missing', { headers: { cookie } })).status).toBe(404);
    expect((await app.request('/api/v1/nope', { headers: { cookie } })).status).toBe(404);
  });
});

describe('events stream', () => {
  async function readUntil(res: Response, needle: string, ms = 2000): Promise<string> {
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let text = '';
    const deadline = Date.now() + ms;
    while (!text.includes(needle) && Date.now() < deadline) {
      const chunk = await Promise.race([
        reader.read(),
        new Promise<{ done: true; value: undefined }>((r) => setTimeout(() => r({ done: true, value: undefined }), 200)),
      ]);
      if (chunk.value) text += decoder.decode(chunk.value);
    }
    await reader.cancel();
    return text;
  }

  it('replays events after a cursor and streams new ones live', async () => {
    const { app, services } = await makeApp();
    const cookie = await login(app);
    const { OWNER } = await import('../src/core/auth/principal.ts');

    services.tasks.create(OWNER, { title: 'Before' });
    const res = await app.request('/api/v1/events?since=0', { headers: { cookie } });
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    setTimeout(() => services.tasks.create(OWNER, { title: 'After' }), 50);
    const text = await readUntil(res, 'After');
    expect(text).toContain('event: change');
    expect(text).toContain('"title":"Before"');
    expect(text).toContain('"title":"After"');
  });

  it('sends a ready cursor when connecting fresh', async () => {
    const { app } = await makeApp();
    const cookie = await login(app);
    const res = await app.request('/api/v1/events', { headers: { cookie } });
    expect(await readUntil(res, 'ready')).toContain('event: ready');
  });
});
