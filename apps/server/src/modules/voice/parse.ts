import { ProviderError, type LlmProvider } from '@helm/providers';
import { PRIORITIES, projectCandidates, type TaskSuggestion } from '@helm/shared';
import { z } from 'zod';
import { readTail, type Tail } from './tail.ts';

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
/** Titles are asked for at up to 60 characters; anything past this is cut and kept in the notes. */
export const TITLE_MAX = 80;

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
 * title, so what was said is never lost. A label spoken at the end ("…, Home, soon") files the
 * tasks there, with or without a model.
 */
export async function draftTasks(
  llm: LlmProvider | null,
  transcript: string,
  projects: NamedProject[],
  o: DraftOptions,
): Promise<{ tasks: TaskSuggestion[]; parsed: boolean; notice?: string }> {
  const tail = readTail(transcript, projects);
  const said = tail.rest;
  if (!llm) return { tasks: [fileUnder(plain(said), tail, true)], parsed: false };

  let answer: z.output<typeof ModelAnswer>;
  try {
    answer = await llm.object({
      system: systemPrompt(projects, o),
      messages: [{ role: 'user', content: said }],
      schema: ModelAnswer,
      name: 'task_drafts',
      signal: o.signal,
    });
  } catch (e) {
    if (!(e instanceof ProviderError)) throw e;
    console.warn(`voice: parsing failed (${e.kind}${e.status ? ` ${e.status}` : ''}): ${e.message}`);
    return { tasks: [fileUnder(plain(said), tail, true)], parsed: false, notice: `Couldn’t fill in the details. ${e.message}` };
  }
  const tasks = answer.tasks
    .slice(0, MAX_TASKS)
    .map((t) => clean(t, projects))
    .filter((t): t is TaskSuggestion => t !== null);
  // The model found nothing task-like: still give the user something to edit.
  if (!tasks.length) tasks.push(plain(said));
  // The label closes the recording, so it's about the last task for sure, and the others when
  // they didn't say otherwise.
  return { tasks: tasks.map((t, i) => fileUnder(t, tail, i === tasks.length - 1)), parsed: true };
}

/** Apply the spoken label; `always` lets it win over what the model chose. */
function fileUnder(t: TaskSuggestion, tail: Tail, always: boolean): TaskSuggestion {
  const out = { ...t };
  const chosen = t.projectId !== null || t.unmatchedProject !== null || t.projectChoices.length > 0;
  if (tail.project !== undefined && (always || !chosen)) {
    Object.assign(out, { projectId: tail.project?.id ?? null, unmatchedProject: null, projectChoices: [] });
  }
  if (tail.priority && (always || t.priority === null)) out.priority = tail.priority;
  return out;
}

/** No model: the start of what was said is the title, and a long recording is kept whole in the notes. */
function plain(transcript: string): TaskSuggestion {
  const said = oneLine(transcript);
  const title = said.length <= TITLE_MAX ? said : shorten(said.split(/(?<=[.!?])\s/)[0]!);
  return {
    title,
    notes: title === said ? null : said.slice(0, 20_000),
    projectId: null,
    unmatchedProject: null,
    projectChoices: [],
    priority: null,
    estimateMinutes: null,
    subtasks: [],
  };
}

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Cut to TITLE_MAX at a word boundary. */
export function shorten(s: string): string {
  if (s.length <= TITLE_MAX) return s;
  const cut = s.slice(0, TITLE_MAX - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > TITLE_MAX / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:.-]+$/, '')}…`;
}

export function clean(t: ModelTask, projects: NamedProject[]): TaskSuggestion | null {
  const full = oneLine(t.title);
  if (!full) return null;
  const title = shorten(full);
  // A title that ran long isn't lost: it opens the notes.
  const notes = [title === full ? '' : full, t.notes?.trim() ?? ''].filter(Boolean).join('\n\n');

  let projectId: string | null = null;
  let unmatchedProject: string | null = null;
  let projectChoices: NamedProject[] = [];
  const heard = t.project ? oneLine(t.project) : '';
  if (heard && !/^inbox$/i.test(heard)) {
    const hits = projectCandidates(heard, projects);
    // Several projects fit: don't guess, let the user pick.
    if (hits.length === 1) projectId = hits[0]!.id;
    else if (hits.length > 1) projectChoices = hits.slice(0, 6).map(({ id, name }) => ({ id, name }));
    else unmatchedProject = heard.slice(0, 60);
  }

  const est = t.estimateMinutes;
  return {
    title,
    notes: notes ? notes.slice(0, 20_000) : null,
    projectId,
    unmatchedProject,
    projectChoices,
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

Be concise. People ramble when they talk; the board needs the gist. The longer the note, the harder you condense.

For each task:
- title: imperative, 3 to 8 words, at most 60 characters, in the language the note was spoken in. Name the outcome, not the whole story ("Add platform links to social profiles", not "Add a link on each social media profile that is specific to that platform"). Drop filler such as "um", "I need to", "remind me to", "add a task".
- notes: only details needed to do the task that don't fit the title (who, where, deadlines, specifics), as a short phrase or a few "- " points. Summarise, don't transcribe; drop repetition and thinking aloud. Write dates as the weekday and date, e.g. "Due Friday 26 September". Don't repeat what the title or other fields already hold (project, priority, estimate). null when there's nothing left to add. Never invent details.
- project: one of the project names below when the note names it or clearly means it, or when the task plainly belongs to one of them by its topic (a dentist visit under Health, an invoice under Work). If it could fit several, or none clearly, null. "Inbox" if the note says inbox. A new name only when the speaker names a project that isn't listed.
- priority: "now" for urgent, today, right away or ASAP. "soon" for this week or soon. "someday" for eventually, one day or no rush. null if not said.
- estimateMinutes: only when a duration is said ("half an hour" is 30). Otherwise null.
- subtasks: the steps the speaker lists for this task, a few words each. Otherwise an empty list.

Speakers often end with a label saying where the task goes: a project name and/or a priority word, like "..., Home, soon". Use it for project and priority, and leave it out of the title and notes.

Today is ${today(o)}.

Projects:
${list}`;
}
