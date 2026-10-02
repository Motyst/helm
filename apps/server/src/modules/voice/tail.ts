import type { Priority, TodaySlot } from '@helm/shared';

interface NamedProject {
  id: string;
  name: string;
}

/** Where the closing words of a recording file it: "Buy milk. Home, soon." */
export interface Tail {
  /** What was said before the closing words; the whole transcript when there were none. */
  rest: string;
  /** undefined = not said, null = Inbox. */
  project?: NamedProject | null;
  priority?: Priority;
  /** "…, today" puts it on Today; "…, today, main" among the main tasks. */
  today?: TodaySlot;
}

const PRIORITY_WORDS: [string, Priority][] = [
  ['right now|now|asap|urgent|urgently', 'now'],
  ['soon', 'soon'],
  ['someday|some day|one day|eventually|no rush', 'someday'],
];
/** Spoken between the task and its label, or after it. */
const FILLER = 'uh+|um+|uhm|erm|er|ah+|hmm+|okay|ok|please|thanks|thank you|that’s it|that\'s it';
/** "…in Home", "…put it in the Home board". */
const MARKER = '(?:(?:put|add|file|move) (?:it|this) )?(?:in|into|to|under|for)(?: the)?';

/** "…put it on today", "…for today". */
const TODAY_LEAD = '(?:(?:put|add) (?:it|this) )?(?:on|for) ';
/** Between "today" and "main": a space or the pause the transcriber wrote. */
const GAP = '[\\s,.;:–—-]+';

/** Trailing spaces and punctuation. */
const SEPARATORS = /[\s.,!?;:…–—-]+$/u;
/** Ends with a pause the transcriber wrote down: "Buy milk." / "Buy milk," */
const PAUSE = /[.,!?;:…–—-]\s*$/u;

const words = (s: string) => s.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const atEnd = (body: string) => new RegExp(`(?<![\\p{L}\\p{N}])${body}$`, 'iu');

type Matcher =
  | { kind: 'filler'; re: RegExp }
  | { kind: 'today'; re: RegExp; today: TodaySlot }
  | { kind: 'priority'; re: RegExp; priority: Priority }
  | { kind: 'project'; re: RegExp; project: NamedProject | null };

function matchers(projects: readonly NamedProject[]): Matcher[] {
  const label = (name: string) => `(?<marker>${MARKER} )?(?:${name})(?<suffix> (?:board|project|panel))?`;
  const named = projects
    .map((p) => ({ p, parts: p.name.split(/[^\p{L}\p{N}]+/u).filter(Boolean) }))
    .filter((x) => x.parts.length > 0)
    // "Home office" before "Home".
    .sort((a, b) => b.parts.join(' ').length - a.parts.join(' ').length);
  return [
    ...named.map(({ p, parts }): Matcher => ({
      kind: 'project',
      re: atEnd(label(parts.map(escape).join('[^\\p{L}\\p{N}]+'))),
      project: p,
    })),
    { kind: 'project', re: atEnd(label('inbox')), project: null },
    {
      kind: 'today',
      re: atEnd(`(?:${TODAY_LEAD})?(?:today${GAP}main(?: task)?|main(?: task)?${GAP}(?:for )?today)`),
      today: 'main',
    },
    { kind: 'today', re: atEnd(`(?:${TODAY_LEAD})?today`), today: 'side' },
    ...PRIORITY_WORDS.map(([w, priority]): Matcher => ({
      kind: 'priority',
      re: atEnd(`(?:(?:priority|prio) )?(?:${w})(?: priority)?`),
      priority,
    })),
    { kind: 'filler', re: atEnd(`(?:${FILLER})`) },
  ];
}

/**
 * Read a label spoken at the end of a recording: a project, a priority and/or "today", in any order,
 * like "Buy milk. Home, soon." Words are taken off the end only while it's clear they're a label:
 * a project needs a pause before it ("…milk. Home") or a lead-in ("…milk in Home", "…Home board"),
 * so "Clean the kitchen" stays whole even with a Kitchen project.
 */
export function readTail(transcript: string, projects: readonly NamedProject[]): Tail {
  const tail: Tail = { rest: transcript };
  const all = matchers(projects);
  let rest = transcript;

  for (;;) {
    const end = rest.replace(SEPARATORS, '');
    let hit: { m: Matcher; at: number; marked: boolean } | null = null;
    for (const m of all) {
      if (m.kind === 'project' && tail.project !== undefined) continue;
      if (m.kind === 'priority' && tail.priority) continue;
      if (m.kind === 'today' && tail.today) continue;
      const r = m.re.exec(end);
      if (r) {
        hit = { m, at: r.index, marked: !!(r.groups?.marker || r.groups?.suffix) };
        break;
      }
    }
    if (!hit) break;

    const before = end.slice(0, hit.at);
    const left = words(before.replace(SEPARATORS, ''));
    const pause = PAUSE.test(before);
    // Keep something to call the task, and without a pause, enough that the label isn't its object.
    if (left === 0 || (!pause && left < 2)) break;
    if (hit.m.kind === 'project' && !pause && !hit.marked) break;

    if (hit.m.kind === 'project') tail.project = hit.m.project;
    if (hit.m.kind === 'priority') tail.priority = hit.m.priority;
    if (hit.m.kind === 'today') tail.today = hit.m.today;
    rest = before;
  }

  if (tail.project === undefined && !tail.priority && !tail.today) return { rest: transcript };
  return { ...tail, rest: rest.replace(SEPARATORS, '') };
}
