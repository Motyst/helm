/**
 * Key words: the one or two words of a title someone would remember the task by, shown in bold
 * so a board can be skimmed. Picked by the AI on the server; this file holds the parts both
 * sides need (checking a pick against the title, splitting a title for display, and a simple
 * rule for when there's no AI).
 */

export const MAX_KEY_WORDS = 2;
/** Longest phrase kept, in words. */
const MAX_PHRASE_WORDS = 3;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wordCount = (s: string) => s.split(/\s+/).filter(Boolean).length;

/** Where `phrase` sits in `title` as whole words, ignoring case; null if it doesn't. */
export function locate(title: string, phrase: string, from = 0): { start: number; end: number } | null {
  const p = phrase.trim();
  if (!p) return null;
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${escape(p)}(?![\\p{L}\\p{N}])`, 'giu');
  re.lastIndex = from;
  const m = re.exec(title);
  return m ? { start: m.index, end: m.index + m[0].length } : null;
}

/**
 * Keep the picks that really are in the title, spelled as the title spells them: at most
 * MAX_KEY_WORDS, none longer than MAX_PHRASE_WORDS words, none overlapping.
 */
export function keyWordsIn(title: string, picks: readonly string[]): string[] {
  const out: { text: string; start: number; end: number }[] = [];
  for (const pick of picks) {
    if (out.length === MAX_KEY_WORDS) break;
    if (wordCount(pick) > MAX_PHRASE_WORDS) continue;
    const at = locate(title, pick);
    if (!at || out.some((o) => at.start < o.end && o.start < at.end)) continue;
    out.push({ text: title.slice(at.start, at.end), ...at });
  }
  return out.map((o) => o.text);
}

export interface TitlePart {
  text: string;
  key: boolean;
}

/** The title cut into plain and key parts, in order. Words no longer in the title are skipped. */
export function splitKeyed(title: string, words: readonly string[] | null | undefined): TitlePart[] {
  const spans = (words ?? [])
    .map((w) => locate(title, w))
    .filter((s): s is { start: number; end: number } => s !== null)
    .sort((a, b) => a.start - b.start);
  const parts: TitlePart[] = [];
  let at = 0;
  for (const s of spans) {
    if (s.start < at) continue;
    if (s.start > at) parts.push({ text: title.slice(at, s.start), key: false });
    parts.push({ text: title.slice(s.start, s.end), key: true });
    at = s.end;
  }
  if (at < title.length) parts.push({ text: title.slice(at), key: false });
  return parts;
}

/** Filler and the action words most tasks start with: never what a task is remembered by. */
const PLAIN = new Set(
  (
    'a an the and or but of for to in on at by with from as is are be it its this that these so if then ' +
    'i my me we our you your they them their he she his her what how when why which who much many more ' +
    'some all each any every other different better new up out about into over off again just also ' +
    'do does get make start finish write create build test check add fix connect review upload change ' +
    'pull explore discuss contact put design schedule outline try look find ask send call buy set ' +
    'update clean sort plan think read see go take give use work prepare organise organize ' +
    'task tasks thing things stuff today tomorrow week month'
  ).split(' '),
);

const WORD = /[\p{L}\p{N}][\p{L}\p{N}'’.-]*[\p{L}\p{N}]|[\p{L}\p{N}]/gu;

/** The words of a title, lower-cased, for counting how common each is on a board. */
export function titleWords(title: string): string[] {
  return (title.match(WORD) ?? []).map((w) => w.toLowerCase());
}

/**
 * No AI: skip filler and action words, then keep the rarest remaining word (`seen` says how many
 * titles on the board use it), then the longer, then the later one. Long titles get two.
 */
export function ruleKeyWords(title: string, seen: (word: string) => number = () => 1): string[] {
  const all = title.match(WORD) ?? [];
  if (all.length === 0) return [];
  if (all.length <= 2) return [title.trim()].filter((t) => wordCount(t) <= MAX_PHRASE_WORDS);
  const seenAt = new Map<string, string>();
  for (const w of all) {
    const k = w.toLowerCase();
    if (k.length > 2 && !PLAIN.has(k) && !seenAt.has(k)) seenAt.set(k, w);
  }
  // Later words win a tie: titles tend to start with the action and end with the thing.
  const order = [...seenAt.keys()].reverse();
  const ranked = order.sort((a, b) => seen(a) - seen(b) || b.length - a.length);
  return keyWordsIn(title, ranked.slice(0, all.length > 6 ? 2 : 1).map((k) => seenAt.get(k)!));
}
