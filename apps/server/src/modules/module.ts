import type { Providers } from '@helm/providers';
import type { Hono } from 'hono';
import type { Config } from '../config.ts';
import type { EventBus } from '../core/events/bus.ts';
import type { Services } from '../core/services/index.ts';
import type { AppEnv } from '../http/env.ts';

export interface ModuleContext {
  config: Config;
  services: Services;
  bus: EventBus;
  /** AI adapters; a null slot means the feature is off (see `providers.reasons`). */
  providers: Providers;
  /** Authenticated router mounted at /api/v1 — add module routes here. */
  api: Hono<AppEnv>;
  /** Root router — for things outside /api/v1 (e.g. /mcp). Handle auth yourself. */
  root: Hono;
}

/**
 * A pluggable feature (voice, assistant, MCP, integrations...). Modules only talk to the
 * core through `services` and `bus`, never to the database directly.
 */
export interface HelmModule {
  name: string;
  register(ctx: ModuleContext): void | Promise<void>;
}
