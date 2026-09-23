import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { openDb } from '@helm/db';
import { createApp } from './app.ts';
import { loadConfig } from './config.ts';
import { EventBus } from './core/events/bus.ts';
import { createServices, type ServiceContext } from './core/services/index.ts';

const config = loadConfig();
const { db, close } = openDb({ path: config.dbPath });
const ctx: ServiceContext = { db, bus: new EventBus(), rules: config.rules, now: () => new Date() };
const services = createServices(ctx);

const app = await createApp({ config, ctx, services, modules: [] });

// Production: serve the built PWA and fall back to index.html for client-side routes.
if (config.webDist) {
  const root = resolve(config.webDist);
  const indexHtml = readFileSync(join(root, 'index.html'), 'utf8');
  app.use('/*', serveStatic({ root }));
  app.get('*', (c) => c.html(indexHtml));
}

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`Helm server listening on http://localhost:${info.port}`);
});

function shutdown() {
  server.close();
  close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
