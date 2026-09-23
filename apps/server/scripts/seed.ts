/**
 * Dev-only: fill an empty database with a few projects and tasks.
 * Usage: pnpm --filter @helm/server seed
 */
import { openDb } from '@helm/db';
import { loadConfig } from '../src/config.ts';
import { OWNER } from '../src/core/auth/principal.ts';
import { EventBus } from '../src/core/events/bus.ts';
import { createServices } from '../src/core/services/index.ts';

const config = loadConfig();
const { db, close } = openDb({ path: config.dbPath });
const s = createServices({ db, bus: new EventBus(), rules: config.rules, now: () => new Date() });

if (s.tasks.board(OWNER).length > 0) {
  console.log('Database already has tasks; not seeding.');
  close();
  process.exit(0);
}

const work = s.projects.create(OWNER, { name: 'Helm' });
const home = s.projects.create(OWNER, { name: 'Home' });
const writing = s.projects.create(OWNER, { name: 'Writing' });

const spec = s.tasks.create(OWNER, { title: 'Wire up the focus view', projectId: work.id, priority: 'now', estimateMinutes: 90 });
for (const title of ['Shared focus logic', 'Live sync over SSE', 'Course line', 'Phone layout', 'Keyboard shortcuts']) {
  s.tasks.create(OWNER, { title, parentTaskId: spec.id });
}
const kids = s.tasks.board(OWNER).filter((t) => t.parentTaskId === spec.id);
s.tasks.complete(OWNER, kids[0]!.id);
s.tasks.complete(OWNER, kids[1]!.id);
s.tasks.start(OWNER, spec.id);

s.tasks.create(OWNER, { title: 'Reply to Marta about the lease', projectId: home.id, priority: 'now', estimateMinutes: 15 });
s.tasks.create(OWNER, { title: 'Draft MCP tool descriptions', projectId: work.id, priority: 'now', estimateMinutes: 45 });
s.tasks.create(OWNER, { title: 'Outline essay on ambient tools', projectId: writing.id, priority: 'now', estimateMinutes: 60 });
s.tasks.create(OWNER, { title: 'Book dentist', priority: 'soon', estimateMinutes: 10 });
s.tasks.create(OWNER, { title: 'Try Tailscale serve for HTTPS', projectId: work.id, priority: 'soon', estimateMinutes: 30 });
s.tasks.create(OWNER, { title: 'Repaint the balcony railing', projectId: home.id, priority: 'someday' });

console.log('Seeded 3 projects and sample tasks.');
close();
