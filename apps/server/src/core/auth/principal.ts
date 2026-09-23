import { forbidden } from '../errors.ts';

export type TokenScope = 'read' | 'read_write';

/** Who is making a request. Every service call takes one. */
export type Principal =
  | { kind: 'owner' }
  | {
      kind: 'token';
      tokenId: string;
      name: string;
      scope: TokenScope;
      /** null = all projects (incl. Inbox); otherwise only these projects. */
      projectIds: string[] | null;
    };

export const OWNER: Principal = { kind: 'owner' };

/** Recorded on every event, e.g. `owner` or `token:claude-desktop`. */
export function actorOf(p: Principal): string {
  return p.kind === 'owner' ? 'owner' : `token:${p.name}`;
}

/** Whether the principal can see tasks in a project (null = Inbox). */
export function canRead(p: Principal, projectId: string | null): boolean {
  if (p.kind === 'owner' || p.projectIds === null) return true;
  return projectId !== null && p.projectIds.includes(projectId);
}

export function canWrite(p: Principal, projectId: string | null): boolean {
  if (p.kind === 'owner') return true;
  return p.scope === 'read_write' && canRead(p, projectId);
}

export function assertRead(p: Principal, projectId: string | null): void {
  if (!canRead(p, projectId)) throw forbidden('Token has no access to this project');
}

export function assertWrite(p: Principal, projectId: string | null): void {
  if (!canRead(p, projectId)) throw forbidden('Token has no access to this project');
  if (!canWrite(p, projectId)) throw forbidden('Token is read-only');
}

/** Creating/reordering projects needs owner or an unscoped read-write token. */
export function assertGlobalWrite(p: Principal): void {
  if (p.kind === 'owner') return;
  if (p.scope !== 'read_write' || p.projectIds !== null) throw forbidden('Token cannot manage projects');
}

export function assertOwner(p: Principal): void {
  if (p.kind !== 'owner') throw forbidden('Owner only');
}

/** Project ids a scoped principal is limited to, or null when unrestricted. */
export function projectScope(p: Principal): string[] | null {
  return p.kind === 'owner' ? null : p.projectIds;
}
