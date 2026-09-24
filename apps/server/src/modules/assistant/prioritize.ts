import type { LlmProvider } from '@helm/providers';
import { PRIORITIES, type PrioritySuggestion } from '@helm/shared';
import { z } from 'zod';
import type { Snapshot } from './snapshot.ts';

const ModelAnswer = z.object({
  summary: z.string(),
  order: z.array(z.object({ ref: z.string(), priority: z.enum(PRIORITIES), reason: z.string() })),
});
export type OrderAnswer = z.output<typeof ModelAnswer>;

export function prioritizePrompt(s: Snapshot, today: string, inProgressLimit: number): string {
  return `You help one person decide the order to work through their open tasks in Helm, their task board.

Rank every top-level open task below exactly once, first = do first. Subtasks are context only; don't rank them.
- A task in progress stays first unless something else is clearly more urgent.
- Priorities: "now" = today, "soon" = in the next days, "someday" = no rush or parked. Keep "now" short: about three tasks, so it stays meaningful.
- Use what's there: deadlines and dates in notes, tasks that unblock others, quick wins that clear the way, tasks going stale, how much is already done.
- reason: one line under 90 characters, specific to that task, in the language of its title. Not generic ("important", "high priority").
- summary: one or two sentences on the overall plan.
${inProgressLimit > 0 ? `Only ${inProgressLimit} task(s) can be in progress at once.` : ''}

Now: ${today}.

${s.text}`;
}

/**
 * Suggest a working order. Refs the model invents or repeats are dropped; tasks it forgot keep
 * their current priority at the end, without a reason.
 */
export async function suggestOrder(
  llm: LlmProvider,
  s: Snapshot,
  o: { today: string; inProgressLimit: number; signal?: AbortSignal },
): Promise<PrioritySuggestion> {
  if (s.open.length === 0) return { summary: 'There are no open tasks to put in order.', items: [] };
  const answer = await llm.object({
    system: prioritizePrompt(s, o.today, o.inProgressLimit),
    messages: [{ role: 'user', content: 'Suggest the order and priorities.' }],
    schema: ModelAnswer,
    name: 'priority_order',
    signal: o.signal,
  });
  return toSuggestion(answer, s);
}

export function toSuggestion(answer: OrderAnswer, s: Snapshot): PrioritySuggestion {
  const openIds = new Set(s.open.map((t) => t.id));
  const seen = new Set<string>();
  const items: PrioritySuggestion['items'] = [];
  for (const o of answer.order) {
    const task = s.refs.get(o.ref.trim());
    if (!task || !openIds.has(task.id) || seen.has(task.id)) continue;
    seen.add(task.id);
    const reason = o.reason.replace(/\s+/g, ' ').trim().slice(0, 200);
    items.push({ taskId: task.id, priority: o.priority, reason: reason || null });
  }
  for (const t of s.open) {
    if (!seen.has(t.id)) items.push({ taskId: t.id, priority: t.priority, reason: null });
  }
  return { summary: answer.summary.trim().slice(0, 600), items };
}
