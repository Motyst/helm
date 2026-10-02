/** Emoji keyword data, as emojilib ships it: emoji → [name, ...keywords]. */
export type EmojiData = Record<string, string[]>;

export interface Emoji {
  emoji: string;
  /** e.g. `red_heart` */
  name: string;
  keywords: string[];
}

export const toEmojis = (data: EmojiData): Emoji[] =>
  Object.entries(data)
    .filter(([, words]) => words.length > 0)
    .map(([emoji, [name, ...keywords]]) => ({ emoji, name: name!, keywords }));

const WORD = '[a-z0-9_+-]{2,30}';
/** Starts a word: line start, a space, or an opening bracket or quote. "10:30" and "Note: x" never trigger. */
const OPEN = /(?:^|[\s([{"'“‘])$/;

/** A `:query` being typed just before the caret. */
export function typingAt(text: string, caret: number): { start: number; query: string } | null {
  const m = new RegExp(`:(${WORD})$`, 'i').exec(text.slice(0, caret));
  if (!m || !OPEN.test(text.slice(0, m.index))) return null;
  return { start: m.index, query: m[1]!.toLowerCase() };
}

/** A whole `:name:` typed just before the caret, to swap for its emoji. */
export function closedAt(text: string, caret: number): { start: number; name: string } | null {
  const m = new RegExp(`:(${WORD}):$`, 'i').exec(text.slice(0, caret));
  if (!m || !OPEN.test(text.slice(0, m.index))) return null;
  return { start: m.index, name: m[1]!.toLowerCase() };
}

/**
 * Best matches first: the name itself, names starting with the query (shortest first, so `:fi`
 * offers fire before firefighter), an exact keyword, then names or keywords containing it.
 * Otherwise emoji order, which puts common faces first.
 */
export function searchEmoji(all: readonly Emoji[], query: string, limit = 8): Emoji[] {
  const q = query.toLowerCase();
  const tiers: Emoji[][] = [[], [], [], []];
  for (const e of all) {
    if (e.name === q) tiers[0]!.push(e);
    else if (e.name.startsWith(q)) tiers[1]!.push(e);
    else if (e.keywords.includes(q)) tiers[2]!.push(e);
    else if (e.name.includes(q) || e.keywords.some((k) => k.startsWith(q))) tiers[3]!.push(e);
  }
  tiers[1]!.sort((a, b) => a.name.length - b.name.length);
  return tiers.flat().slice(0, limit);
}

/** The emoji a whole `:name:` means, by name or exact keyword. */
export function exactEmoji(all: readonly Emoji[], name: string): Emoji | null {
  const hit = searchEmoji(all, name, 1)[0];
  return hit && (hit.name === name || hit.keywords.includes(name)) ? hit : null;
}
