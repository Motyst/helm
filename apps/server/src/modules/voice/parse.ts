import { ProviderError, type LlmProvider } from '@helm/providers';
import { matchProject, PRIORITIES, type TaskSuggestion } from '@helm/shared';
import { z } from 'zod';

/** What the model fills in. Plain on purpose: limits are enforced in `clean`. */
const ModelAnswer = z.object({
  tasks: z.array(
    z.object({
      title: z.string(),
      notes: z.string().nullable(),
      project: z.string().nullable(),
      priority: z.enum(PRIORITIES).nullable(),
      estimateMinutes: z.number().int().nullable(),
      subtasks: z.array(z.string()),
    }),
  ),
});
type ModelTask = z.output<typeof ModelAnswer>['tasks'][number];

const MAX_TASKS = 10;
const MAX_SUBTASKS = 50;

export interface DraftOptions {
  now: Date;
  /** IANA zone of the speaker, for "today" and "tomorrow". */
  timeZone?: string;
  signal?: AbortSignal;
}

interface NamedProject {
  id: string;
  name: string;
}

/**
 * Turn a transcript into task suggestions. Without a working model the transcript becomes the
 * title, so what was said is never lost.
 */
export async function draftTasks(
  llm: LlmProvider | null,
  transcript: string,
  projects: NamedProject[],
  o: DraftOptions,
): Promise<{ tasks: TaskSuggestion[]; parsed: boolean; notice?: string }> {
  if (!llm) return { tasks: [plain(transcript)], parsed: false };

  let answer: z.output<typeof ModelAnswer>;
  try {
    answer = await llm.object({
      system: systemPrompt(projects, o),
      messages: [{ role: 'user', content: transcript }],
      schema: ModelAnswer,
      name: 'task_drafts',
      signal: o.signal,
    });
  } catch (e) {
    if (!(e instanceof ProviderError)) throw e;
    console.warn(`voice: parsing failed (${e.kind}${e.status ? ` ${e.status}` : ''}): ${e.message}`);
    return { tasks: [plain(transcript)], parsed: false, notice: `Couldn’t fill in the details. ${e.message}` };
  }
  const tasks = answer.tasks
    .slice(0, MAX_TASKS)
    .map((t) => clean(t, projects))
    .filter((t): t is TaskSuggestion => t !== null);
  // The model found nothing task-like: still give the user something to edit.
  return { tasks: tasks.length ? tasks : [plain(transcript)], parsed: true };
}

function plain(transcript: string): TaskSuggestion {
  return {
    title: oneLine(transcript).slice(0, 500),
    notes: null,
    projectId: null,
    unmatchedProject: null,
    priority: null,
    estimateMinutes: null,
    subtasks: [],
  };
}

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();

export function clean(t: ModelTask, projects: NamedProject[]): TaskSuggestion | null {
  const title = oneLine(t.title).slice(0, 500);
  if (!title) return null;

  let projectId: string | null = null;
  let unmatchedProject: string | null = null;
  const heard = t.project ? oneLine(t.project) : '';
  if (heard && !/^inbox$/i.test(heard)) {
    const match = matchProject(heard, projects);
    if (match) projectId = match.id;
    else unmatchedProject = heard.slice(0, 60);
  }

  const est = t.estimateMinutes;
  return {
    title,
    notes: t.notes?.trim() ? t.notes.trim().slice(0, 20_000) : null,
    projectId,
    unmatchedProject,
    priority: t.priority,
    estimateMinutes: est !== null && est >= 1 && est <= 24 * 60 ? est : null,
    subtasks: t.subtasks
      .map((s) => oneLine(s).slice(0, 500))
      .filter(Boolean)
      .slice(0, MAX_SUBTASKS),
  };
}

function today(o: DraftOptions): string {
  const fmt = (timeZone?: string) =>
    new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone }).format(
      o.now,
    );
  try {
    return fmt(o.timeZone);
  } catch {
    return fmt(); // unknown zone
  }
}

export function systemPrompt(projects: NamedProject[], o: DraftOptions): string {
  const list = projects.length ? projects.map((p) => `- ${p.name}`).join('\n') : '(none yet)';
  return `You turn a spoken note into tasks for Helm, a personal task board. The user will check your draft before anything is saved.

Return one entry per separate to-do. Most notes are a single task. Steps of one piece of work are subtasks of that task, not separate tasks.

For each task:
- title: short and imperative, under 80 characters, in the language the note was spoken in. Drop filler such as "um", "I need to", "remind me to", "add a task".
- notes: details that don't fit the title (who, where, context, deadlines). Write dates as the weekday and date, e.g. "Due Friday 26 September". Don't repeat what the other fields already hold (project, priority, estimate). null when there's nothing left to add. Never invent details.
- project: one of the project names below when the note says or clearly means it. "Inbox" if the note says inbox. A new name only when the speaker names a project that isn't listed. Otherwise null.
- priority: "now" for urgent, today, right away or ASAP. "soon" for this week or soon. "someday" for eventually, one day or no rush. null if not said.
- estimateMinutes: only when a duration is said ("half an hour" is 30). Otherwise null.
- subtasks: the steps the speaker lists for this task, short. Otherwise an empty list.

Today is ${today(o)}.

Projects:
${list}`;
}
