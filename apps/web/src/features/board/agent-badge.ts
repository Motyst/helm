import type { Task } from '@helm/shared';

/** Who holds a hand-off, for people: `token:Claude Code` → Claude Code. */
export function agentName(claimedBy: string | null): string {
  if (!claimedBy) return 'An agent';
  if (claimedBy === 'owner') return 'You';
  if (claimedBy === 'ai:assistant') return 'The assistant';
  return claimedBy.replace(/^(token|ai):/, '') || 'An agent';
}

/** Short label for a card, or null when the task isn't handed to an agent. */
export function agentBadge(task: Pick<Task, 'agentState' | 'agentClaimedBy'>): string | null {
  switch (task.agentState) {
    case 'ready':
      return 'For an agent';
    case 'working':
      return `${agentName(task.agentClaimedBy)} on it`;
    case 'review':
      return 'Review';
    default:
      return null;
  }
}
