import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { openDb } from '@helm/db';
import { createApp } from './app.ts';
import { loadConfig } from './config.ts';
import { EventBus } from './core/events/bus.ts';
import { createServices, type ServiceContext } from './core/services/index.ts';
import { mcpModule } from './modules/mcp/index.ts';

const config = loadConfig();
const { db, close } = openDb({ path: config.dbPath });
const ctx: ServiceContext = { db, bus: new EventBus(), rules: config.rules, now: () => new Date() };
const services = createServices(ctx);

const app = await createApp({ config, ctx, services, modules: [mcpModule] });

// Production: serve the built PWA and fall back to index.html for client-side routes.
const webRoot = config.webDist ? resolve(config.webDist) : null;
if (webRoot && !existsSync(join(webRoot, 'index.html'))) {
  console.warn(`HELM_WEB_DIST is set but ${webRoot} has no build yet. Run \`pnpm build\`; serving the API only.`);
} else if (webRoot) {
  const indexHtml = readFileSync(join(webRoot, 'index.html'), 'utf8');
  app.use(
    '/*',
    serveStatic({
      root: webRoot,
      onFound: (path, c) => {
        // Hashed build output never changes; everything else (index, service worker, manifest)
        // must be revalidated so a new deploy is picked up.
        c.header(
          'Cache-Control',
          /[\\/]assets[\\/]/.test(path) ? 'public, max-age=31536000, immutable' : 'no-cache',
        );
      },
    }),
  );
  app.get('*', (c) => {
    c.header('Cache-Control', 'no-cache');
    return c.html(indexHtml);
  });
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
