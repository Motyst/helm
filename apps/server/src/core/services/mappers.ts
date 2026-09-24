import type { ApiTokenRow, ProjectRow, TaskRow } from '@helm/db';
import type { ApiToken, Project, Task } from '@helm/shared';

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

export function toTask(r: TaskRow): Task {
  return {
    id: r.id,
    title: r.title,
    notes: r.notes,
    projectId: r.projectId,
    priority: r.priority,
    estimateMinutes: r.estimateMinutes,
    status: r.status,
    parentTaskId: r.parentTaskId,
    position: r.position,
    source: r.source,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    startedAt: iso(r.startedAt),
    completedAt: iso(r.completedAt),
    deletedAt: iso(r.deletedAt),
  };
}

export function toProject(r: ProjectRow): Project {
  return {
    id: r.id,
    name: r.name,
    color: r.color,
    collapsed: r.collapsed,
    position: r.position,
    archivedAt: iso(r.archivedAt),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export function toApiToken(r: ApiTokenRow): ApiToken {
  return {
    id: r.id,
    name: r.name,
    prefix: r.prefix,
    scope: r.scope,
    projectIds: r.projectIds ?? null,
    createdAt: r.createdAt.toISOString(),
    lastUsedAt: iso(r.lastUsedAt),
    expiresAt: iso(r.expiresAt),
    revokedAt: iso(r.revokedAt),
  };
}
