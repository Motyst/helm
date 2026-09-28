import { eq } from 'drizzle-orm';
import { pushSubscriptions, settings, type PushSubscriptionRow } from '@helm/db';
import { PushSubscriptionInput } from '@helm/shared';
import { ulid } from 'ulidx';
import { assertOwner, type Principal } from '../auth/principal.ts';
import { parse } from '../errors.ts';
import type { ServiceContext } from './context.ts';

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

const VAPID_KEY = 'vapid';

/** Where timer alerts go: Web Push subscriptions, and the server's key pair for signing them. */
export class PushService {
  constructor(private readonly ctx: ServiceContext) {}

  /** The stored key pair, made with `generate` on first use. */
  vapidKeys(generate: () => VapidKeys): VapidKeys {
    const read = () => this.ctx.db.select().from(settings).where(eq(settings.key, VAPID_KEY)).get();
    if (!read()) {
      this.ctx.db.insert(settings).values({ key: VAPID_KEY, value: JSON.stringify(generate()) }).onConflictDoNothing().run();
    }
    return JSON.parse(read()!.value) as VapidKeys;
  }

  subscribe(p: Principal, input: unknown): void {
    assertOwner(p);
    const i = parse(PushSubscriptionInput, input);
    this.ctx.db
      .insert(pushSubscriptions)
      .values({ id: ulid(), endpoint: i.endpoint, p256dh: i.keys.p256dh, auth: i.keys.auth, createdAt: this.ctx.now() })
      .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: { p256dh: i.keys.p256dh, auth: i.keys.auth } })
      .run();
  }

  unsubscribe(p: Principal, endpoint: string): void {
    assertOwner(p);
    this.remove(endpoint);
  }

  list(): PushSubscriptionRow[] {
    return this.ctx.db.select().from(pushSubscriptions).all();
  }

  /** Drop a subscription the push service says is gone. */
  remove(endpoint: string): void {
    this.ctx.db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint)).run();
  }
}
