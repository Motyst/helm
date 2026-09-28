import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.ts';
import { OWNER } from '../src/core/auth/principal.ts';
import { HelmError } from '../src/core/errors.ts';
import { createTimerModule, type AlertPayload, type PushTarget } from '../src/modules/timer/index.ts';
import { setup, testConfig, token } from './helpers.ts';

const o = OWNER;

function errCode(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    if (e instanceof HelmError) return e.code;
    throw e;
  }
  throw new Error('expected an error');
}

describe('TimerService', () => {
  it('starts, pauses, resumes, extends and stops', () => {
    const { services, clock } = setup();
    clock.set('2026-09-28T10:00:00.000Z');
    const t = services.timers.start(o, { minutes: 25, label: 'Write the summary' });
    expect(t).toMatchObject({ status: 'running', label: 'Write the summary', durationMs: 25 * 60_000 });
    expect(Date.parse(t.endsAt!)).toBe(Date.parse('2026-09-28T10:00:01.000Z') + 25 * 60_000);

    clock.set('2026-09-28T10:05:00.000Z');
    const paused = services.timers.pause(o);
    expect(paused).toMatchObject({ status: 'paused', endsAt: null });
    expect(paused.remainingMs).toBe(20 * 60_000);

    clock.set('2026-09-28T11:00:00.000Z');
    const resumed = services.timers.resume(o);
    expect(resumed.status).toBe('running');
    expect(Date.parse(resumed.endsAt!)).toBe(Date.parse('2026-09-28T11:00:01.000Z') + paused.remainingMs!);

    const longer = services.timers.extend(o, { minutes: 5 });
    expect(Date.parse(longer.endsAt!) - Date.parse(resumed.endsAt!)).toBe(5 * 60_000);
    expect(longer.durationMs).toBe(30 * 60_000);

    expect(services.timers.stop(o).ended).toBe(true);
    expect(services.timers.current(o)).toBeNull();
    expect(errCode(() => services.timers.pause(o))).toBe('not_found');
  });

  it('a new timer replaces the live one, and only the owner may use timers', () => {
    const { services } = setup();
    const a = services.timers.start(o, { minutes: 10 });
    const b = services.timers.start(o, { minutes: 5 });
    expect(services.timers.current(o)?.id).toBe(b.id);
    expect(b.id).not.toBe(a.id);
    expect(errCode(() => services.timers.start(token(), { minutes: 5 }))).toBe('forbidden');
    expect(errCode(() => services.timers.start(o, { minutes: 0 }))).toBe('invalid');
  });

  it('rings only when due, then stays until dismissed; adding time restarts it', () => {
    const { services, clock } = setup();
    clock.set('2026-09-28T10:00:00.000Z');
    const t = services.timers.start(o, { minutes: 1 });
    expect(services.timers.finishIfDue(t.id)).toBeNull();

    clock.set('2026-09-28T10:02:00.000Z');
    expect(services.timers.finishIfDue(t.id)?.status).toBe('finished');
    expect(services.timers.finishIfDue(t.id)).toBeNull();
    expect(services.timers.current(o)?.status).toBe('finished');
    expect(services.timers.next()).toBeNull();

    const again = services.timers.extend(o, { minutes: 5 });
    expect(again.status).toBe('running');
    expect(services.timers.next()?.id).toBe(t.id);

    clock.set('2026-09-28T10:10:00.000Z');
    services.timers.finishIfDue(t.id);
    expect(services.timers.stop(o).ended).toBe(true);
  });
});

describe('timer module', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  async function makeApp() {
    vi.useFakeTimers();
    const env = setup();
    const sent: { target: PushTarget; payload: AlertPayload }[] = [];
    const gone = new Set<string>();
    const app = await createApp({
      config: testConfig,
      ctx: env.ctx,
      services: env.services,
      modules: [
        createTimerModule({
          now: () => env.ctx.now().getTime(),
          sender: async (target, payload) => {
            if (gone.has(target.endpoint)) return 'gone';
            sent.push({ target, payload });
            return 'ok';
          },
        }),
      ],
    });
    const res = await app.request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: testConfig.ownerPassword }),
    });
    const cookie = res.headers.get('set-cookie')!.split(';')[0]!;
    const call = (method: string, path: string, body?: unknown) =>
      app.request(`/api/v1${path}`, {
        method,
        headers: { cookie, 'content-type': 'application/json', origin: 'http://localhost' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    return { ...env, sent, gone, call };
  }

  it('pushes to every subscribed device when the timer ends and drops gone ones', async () => {
    const { call, sent, gone, clock, services } = await makeApp();
    const sub = (n: number) => ({ endpoint: `https://push.example/${n}`, keys: { p256dh: 'key', auth: 'auth' } });
    expect((await call('POST', '/push/subscriptions', sub(1))).status).toBe(201);
    expect((await call('POST', '/push/subscriptions', sub(2))).status).toBe(201);
    gone.add(sub(2).endpoint);

    clock.set('2026-09-28T10:00:00.000Z');
    const started = await call('POST', '/timer', { minutes: 1, label: 'Tea' });
    expect(started.status).toBe(201);
    expect(sent).toHaveLength(0);

    clock.set('2026-09-28T10:01:30.000Z');
    await vi.advanceTimersByTimeAsync(2 * 60_000);
    expect(sent.map((s) => s.payload.body)).toEqual(['Tea']);
    expect(services.push.list().map((s) => s.endpoint)).toEqual([sub(1).endpoint]);

    const current = (await (await call('GET', '/timer')).json()) as { timer: { status: string } };
    expect(current.timer.status).toBe('finished');
    expect((await call('DELETE', '/timer')).status).toBe(200);
    expect(((await (await call('GET', '/timer')).json()) as { timer: unknown }).timer).toBeNull();
  });

  it('does not ring a paused or stopped timer', async () => {
    const { call, sent, clock } = await makeApp();
    await call('POST', '/push/subscriptions', { endpoint: 'https://push.example/1', keys: { p256dh: 'k', auth: 'a' } });
    clock.set('2026-09-28T10:00:00.000Z');
    await call('POST', '/timer', { minutes: 1 });
    await call('POST', '/timer/pause');
    clock.set('2026-09-28T10:05:00.000Z');
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(sent).toHaveLength(0);
    await call('DELETE', '/timer');
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(sent).toHaveLength(0);
  });
});
