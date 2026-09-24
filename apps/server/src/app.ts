import { Hono } from 'hono';
import { csrf } from 'hono/csrf';
import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { NO_PROVIDERS, type Providers } from '@helm/providers';
import type { Config } from './config.ts';
import { HelmError, type ErrorCode } from './core/errors.ts';
import { eventRoutes } from './core/events/sse.ts';
import type { ServiceContext, Services } from './core/services/index.ts';
import { authenticate, authRoutes, type TokenResolver } from './http/auth.ts';
import type { AppEnv } from './http/env.ts';
import { apiRoutes } from './http/routes.ts';
import type { HelmModule } from './modules/module.ts';

const STATUS: Record<ErrorCode, ContentfulStatusCode> = {
  invalid: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  too_large: 413,
  unsupported_media: 415,
  unavailable: 503,
  upstream: 502,
};

export interface AppDeps {
  config: Config;
  ctx: ServiceContext;
  services: Services;
  modules?: HelmModule[];
  /** AI adapters for modules (voice, assistant). Defaults to none. */
  providers?: Providers;
  resolveToken?: TokenResolver;
}

export async function createApp({
  config,
  ctx,
  services,
  modules = [],
  providers = NO_PROVIDERS,
  resolveToken = (secret) => services.tokens.resolve(secret),
}: AppDeps) {
  const app = new Hono();

  app.onError((err, c) => {
    if (err instanceof HelmError) {
      return c.json({ error: { code: err.code, message: err.message, details: err.details } }, STATUS[err.code]);
    }
    if (err instanceof HTTPException) {
      const status = err.status as ContentfulStatusCode;
      return c.json({ error: { code: status === 403 ? 'forbidden' : 'http_error', message: err.message } }, status);
    }
    console.error(err);
    return c.json({ error: { code: 'internal', message: 'Internal error' } }, 500);
  });

  // Rejects cross-site form-style posts (cookie sessions); bearer-token clients aren't browsers.
  app.use('/api/*', csrf());

  app.get('/api/v1/health', (c) => c.json({ ok: true }));
  app.route('/api/v1/auth', authRoutes(config));

  const api = new Hono<AppEnv>();
  api.use('*', authenticate(config, resolveToken));
  api.route('/', apiRoutes(services));
  api.route('/', eventRoutes(ctx.db, ctx.bus));

  for (const m of modules) {
    await m.register({ config, services, bus: ctx.bus, providers, api, root: app });
  }

  app.route('/api/v1', api);
  app.all('/api/*', (c) => c.json({ error: { code: 'not_found', message: 'No such endpoint' } }, 404));
  return app;
}
