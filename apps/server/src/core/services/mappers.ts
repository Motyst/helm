import type { ProjectRow, TaskRow } from '@helm/db';
import type { Project, Task } from '@helm/shared';

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
