import type { ChatMessage, LlmProvider, ToolSpec } from '@helm/providers';
import { AssistantChange, matchProject, PRIORITIES, type ChatStreamEvent, type Project } from '@helm/shared';
import { z } from 'zod';
import type { Snapshot } from './snapshot.ts';

/** Flat on purpose (every key present, null = not set): easy for strict tool schemas. */
const Proposal = z.object({
  summary: z.string(),
  changes: z.array(
    z.object({
      action: z.enum(['create', 'update', 'start', 'stop', 'complete', 'reopen']),
      ref: z.string().nullable(),
      title: z.string().nullable(),
      notes: z.string().nullable(),
      project: z.string().nullable(),
      priority: z.enum(PRIORITIES).nullable(),
      estimateMinutes: z.number().int().nullable(),
      parentRef: z.string().nullable(),
      subtasks: z.array(z.string()),
    }),
  ),
});
type ProposedChange = z.output<typeof Proposal>['changes'][number];

export const PROPOSE_TOOL: ToolSpec = {
  name: 'propose_changes',
  description:
    'Propose changes to the board. Nothing changes until the user applies them. ' +
    'action create: new task (title required; parentRef makes it a subtask of that task; subtasks lists new subtasks). ' +
    'action update: change fields of task `ref`; null fields stay as they are. ' +
    'start / stop / complete / reopen: change the status of task `ref`. ' +
    'project is a project name or "Inbox".',
  schema: Proposal,
};

export function chatPrompt(s: Snapshot, today: string, inProgressLimit: number): string {
  return `You are the assistant inside Helm, one person's task board. You see their board below.

- Answer briefly and concretely, in the language the user writes in. Plain text: no headings, tables or bold. Short "-" lists are fine.
- Refer to tasks by title, never by ref.
- You can't change anything yourself. When the user asks for changes (add, edit, move, start, finish or reopen tasks, split one into subtasks), call propose_changes once with all of them and say in a sentence what you proposed. The user reviews and applies them. Don't propose changes they didn't ask for. There is no way to delete tasks.
${inProgressLimit > 0 ? `- Only ${inProgressLimit} task(s) can be in progress at once; starting another pauses the oldest.` : ''}
- Priorities: now = today, soon = in the next days, someday = no rush.

Now: ${today}.

${s.text}`;
}

const oneLine = (v: string) => v.replace(/\s+/g, ' ').trim();

function projectIdFor(name: string | null, projects: Project[]): string | null | undefined {
  if (name === null) return undefined;
  const n = oneLine(name);
  if (!n || /^inbox$/i.test(n)) return null;
  // An unknown project isn't created from chat; the field is left alone.
  return matchProject(n, projects)?.id;
}

/** Model output → changes with real ids. Anything unresolvable or invalid is dropped. */
export function toChanges(proposed: ProposedChange[], s: Snapshot): AssistantChange[] {
  const out: AssistantChange[] = [];
  for (const c of proposed) {
    const task = c.ref ? s.refs.get(c.ref.trim()) : undefined;
    const estimate = c.estimateMinutes !== null && c.estimateMinutes >= 1 && c.estimateMinutes <= 1440 ? c.estimateMinutes : undefined;
    const notes = c.notes === null ? undefined : c.notes.trim() || null;
    let candidate: unknown;

    if (c.action === 'create') {
      const parent = c.parentRef ? s.refs.get(c.parentRef.trim()) : undefined;
      const projectId = parent ? undefined : projectIdFor(c.project, s.projects);
      const subtasks = c.subtasks.map(oneLine).filter(Boolean);
      candidate = {
        action: 'create',
        title: oneLine(c.title ?? ''),
        ...(notes ? { notes } : {}),
        ...(projectId !== undefined ? { projectId } : {}),
        ...(c.priority ? { priority: c.priority } : {}),
        ...(estimate ? { estimateMinutes: estimate } : {}),
        ...(parent ? { parentTaskId: parent.id } : {}),
        ...(subtasks.length && !parent ? { subtasks } : {}),
      };
    } else if (c.action === 'update') {
      if (!task) continue;
      const projectId = task.parentTaskId ? undefined : projectIdFor(c.project, s.projects);
      const fields = {
        ...(c.title && oneLine(c.title) && oneLine(c.title) !== task.title ? { title: oneLine(c.title) } : {}),
        ...(notes !== undefined && notes !== task.notes ? { notes } : {}),
        ...(projectId !== undefined && projectId !== task.projectId ? { projectId } : {}),
        ...(c.priority && c.priority !== task.priority ? { priority: c.priority } : {}),
        ...(estimate && estimate !== task.estimateMinutes ? { estimateMinutes: estimate } : {}),
      };
      if (Object.keys(fields).length === 0) continue;
      candidate = { action: 'update', taskId: task.id, ...fields };
    } else {
      if (!task) continue;
      candidate = { action: c.action, taskId: task.id };
    }

    const parsed = AssistantChange.safeParse(candidate);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

/** Stream a chat reply. Text is passed through; a proposal arrives once, at the end. */
export async function* chatReply(
  llm: LlmProvider,
  messages: ChatMessage[],
  s: Snapshot,
  o: { today: string; inProgressLimit: number; signal?: AbortSignal },
): AsyncGenerator<ChatStreamEvent> {
  for await (const chunk of llm.chat({
    system: chatPrompt(s, o.today, o.inProgressLimit),
    messages,
    tools: [PROPOSE_TOOL],
    signal: o.signal,
  })) {
    if (chunk.type === 'text') {
      yield { type: 'text', delta: chunk.delta };
    } else if (chunk.name === PROPOSE_TOOL.name) {
      const proposal = chunk.input as z.output<typeof Proposal>;
      const changes = toChanges(proposal.changes, s);
      if (changes.length) yield { type: 'proposal', summary: oneLine(proposal.summary).slice(0, 600), changes };
    }
  }
}
