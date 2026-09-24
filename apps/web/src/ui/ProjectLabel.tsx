import type { CSSProperties } from 'react';
import type { Project } from '@helm/shared';

export type ProjectMap = Map<string, Project>;

/** Project name lettered like a water name on a chart, with its color swatch. */
export function ProjectLabel({ projectId, projects }: { projectId: string | null; projects: ProjectMap }) {
  const p = projectId ? projects.get(projectId) : undefined;
  return (
    <span className="chart-label" style={p ? ({ '--swatch': p.color } as CSSProperties) : undefined}>
      {p?.name ?? 'Inbox'}
    </span>
  );
}
