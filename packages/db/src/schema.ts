import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core';

// Timestamps are stored as integer milliseconds since epoch.
const ts = (name: string) => integer(name, { mode: 'timestamp_ms' });

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  color: text('color').notNull(),
  collapsed: integer('collapsed', { mode: 'boolean' }).notNull().default(false),
  position: text('position').notNull(),
  archivedAt: ts('archived_at'),
  createdAt: ts('created_at').notNull(),
  updatedAt: ts('updated_at').notNull(),
});

export const tasks = sqliteTable(
  'tasks',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    notes: text('notes'),
    projectId: text('project_id').references(() => projects.id, { onDelete: 'set null' }),
    priority: text('priority', { enum: ['now', 'soon', 'someday'] }).notNull(),
    estimateMinutes: integer('estimate_minutes'),
    status: text('status', { enum: ['todo', 'in_progress', 'done'] }).notNull(),
    parentTaskId: text('parent_task_id').references((): AnySQLiteColumn => tasks.id, { onDelete: 'cascade' }),
    position: text('position').notNull(),
    source: text('source').notNull(),
    createdAt: ts('created_at').notNull(),
    updatedAt: ts('updated_at').notNull(),
    startedAt: ts('started_at'),
    completedAt: ts('completed_at'),
    deletedAt: ts('deleted_at'),
  },
  (t) => [
    index('tasks_parent_idx').on(t.parentTaskId),
    index('tasks_project_idx').on(t.projectId),
    index('tasks_status_idx').on(t.status),
    index('tasks_completed_idx').on(t.completedAt),
    check('tasks_priority_chk', sql`${t.priority} in ('now', 'soon', 'someday')`),
    check('tasks_status_chk', sql`${t.status} in ('todo', 'in_progress', 'done')`),
  ],
);

export const apiTokens = sqliteTable('api_tokens', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  /** First chars of the token, shown in UI to identify it. */
  prefix: text('prefix').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  scope: text('scope', { enum: ['read', 'read_write'] }).notNull(),
  /** JSON array of project ids, or null for all projects (incl. Inbox). */
  projectIds: text('project_ids', { mode: 'json' }).$type<string[] | null>(),
  createdAt: ts('created_at').notNull(),
  lastUsedAt: ts('last_used_at'),
  expiresAt: ts('expires_at'),
  revokedAt: ts('revoked_at'),
});

/** Append-only change log. Drives realtime sync (id = SSE cursor) and the audit trail. */
export const events = sqliteTable(
  'events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    at: ts('at').notNull(),
    actor: text('actor').notNull(),
    entity: text('entity', { enum: ['task', 'project'] }).notNull(),
    entityId: text('entity_id').notNull(),
    /** Project the entity belongs to (for scope-filtering the stream); null = Inbox / not applicable. */
    projectId: text('project_id'),
    action: text('action').notNull(),
    data: text('data', { mode: 'json' }).notNull(),
  },
  (t) => [index('events_entity_idx').on(t.entity, t.entityId)],
);

export type ProjectRow = typeof projects.$inferSelect;
export type TaskRow = typeof tasks.$inferSelect;
export type ApiTokenRow = typeof apiTokens.$inferSelect;
export type EventRow = typeof events.$inferSelect;
