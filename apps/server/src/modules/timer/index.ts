import type { Timer } from '@helm/shared';
import webpush from 'web-push';
import { assertOwner } from '../../core/auth/principal.ts';
import { invalid } from '../../core/errors.ts';
import type { PushService } from '../../core/services/push.service.ts';
import { jsonBody } from '../../http/env.ts';
import type { HelmModule } from '../module.ts';

/** Sent to the phone. The service worker shows it (push-handler.js). */
export interface AlertPayload {
  title: string;
  body: string;
  tag: string;
  url: string;
}

export interface PushTarget {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** Delivers one push. Resolves to 'gone' when the subscription no longer exists. */
export type PushSender = (target: PushTarget, payload: AlertPayload) => Promise<'ok' | 'gone'>;

/** Shown in the push service's logs if it needs to reach whoever runs this server. */
const VAPID_SUBJECT = 'https://github.com/Motyst/helm';
/** A timer that rang while the server was down for longer than this rings quietly. */
const STALE_MS = 10 * 60_000;
/** setTimeout's ceiling; longer waits are re-armed when it fires. */
const MAX_DELAY = 2 ** 31 - 1;

function webPushSender(push: PushService): PushSender {
  const keys = push.vapidKeys(() => webpush.generateVAPIDKeys());
  webpush.setVapidDetails(VAPID_SUBJECT, keys.publicKey, keys.privateKey);
  return async (target, payload) => {
    try {
      // High urgency and a short TTL: a timer alert is useless an hour late.
      await webpush.sendNotification(target, JSON.stringify(payload), { TTL: 15 * 60, urgency: 'high' });
      return 'ok';
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) return 'gone';
      throw err;
    }
  };
}

function alertFor(t: Timer): AlertPayload {
  return { title: 'Time’s up', body: t.label ?? 'Your Helm timer has finished.', tag: 'helm-timer', url: '/' };
}

/**
 * Countdown timer with Web Push alerts. The server keeps the time, so every device shows the
 * same countdown, and rings every subscribed device when it ends, even with the app closed.
 */
export function createTimerModule(opts: { sender?: PushSender; now?: () => number } = {}): HelmModule {
  const now = opts.now ?? Date.now;
  return {
    name: 'timer',
    register({ services, bus, api }) {
      const send = opts.sender ?? webPushSender(services.push);
      const publicKey = opts.sender ? '' : services.push.vapidKeys(() => webpush.generateVAPIDKeys()).publicKey;

      async function alertAll(payload: AlertPayload): Promise<{ sent: number; failed: number }> {
        let sent = 0;
        let failed = 0;
        await Promise.all(
          services.push.list().map(async (s) => {
            try {
              const r = await send({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
              if (r === 'gone') services.push.remove(s.endpoint);
              else sent++;
            } catch (err) {
              failed++;
              console.error('[timer] push failed:', err instanceof Error ? err.message : err);
            }
          }),
        );
        return { sent, failed };
      }

      // ----- Scheduler: one timeout, re-armed on every timer change -----
      let handle: ReturnType<typeof setTimeout> | undefined;
      const arm = () => {
        clearTimeout(handle);
        const next = services.timers.next();
        if (!next) return;
        handle = setTimeout(() => ring(next.id, next.endsAt), Math.min(MAX_DELAY, Math.max(0, next.endsAt.getTime() - now())));
        handle.unref?.();
      };
      const ring = (id: string, endsAt: Date) => {
        // Emits a `finished` event, which re-arms through the bus subscription below.
        const t = services.timers.finishIfDue(id);
        if (!t) return arm();
        if (now() - endsAt.getTime() < STALE_MS) void alertAll(alertFor(t));
      };
      bus.subscribe((e) => {
        if (e.entity === 'timer') arm();
      });
      arm();

      // ----- Routes (owner only) -----
      api.get('/timer', (c) => c.json({ timer: services.timers.current(c.var.principal) }));
      api.post('/timer', async (c) => c.json(services.timers.start(c.var.principal, await jsonBody(c)), 201));
      api.post('/timer/pause', (c) => c.json(services.timers.pause(c.var.principal)));
      api.post('/timer/resume', (c) => c.json(services.timers.resume(c.var.principal)));
      api.post('/timer/extend', async (c) => c.json(services.timers.extend(c.var.principal, await jsonBody(c))));
      api.delete('/timer', (c) => c.json(services.timers.stop(c.var.principal)));

      api.get('/push/key', (c) => {
        assertOwner(c.var.principal);
        return c.json({ publicKey });
      });
      api.post('/push/subscriptions', async (c) => {
        services.push.subscribe(c.var.principal, await jsonBody(c));
        return c.json({ ok: true }, 201);
      });
      api.delete('/push/subscriptions', async (c) => {
        const body = (await jsonBody(c)) as { endpoint?: unknown };
        if (typeof body.endpoint !== 'string') throw invalid('endpoint is required');
        services.push.unsubscribe(c.var.principal, body.endpoint);
        return c.json({ ok: true });
      });
      api.post('/push/test', async (c) => {
        assertOwner(c.var.principal);
        const result = await alertAll({
          title: 'Helm alerts are on',
          body: 'Timers will ring on this device.',
          tag: 'helm-test',
          url: '/',
        });
        return c.json(result);
      });
    },
  };
}

export const timerModule = createTimerModule();
