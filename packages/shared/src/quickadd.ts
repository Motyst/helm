import type { Priority } from './schemas.ts';

export interface QuickAdd {
  /** Title with shorthand tokens removed. */
  title: string;
  /** Text after `#`, to match against project names. */
  projectQuery: string | null;
  priority: Priority | null;
  estimateMinutes: number | null;
}

const PRIORITY_TOKENS: Record<string, Priority> = {
  now: 'now',
  n: 'now',
  soon: 'soon',
  s: 'soon',
  someday: 'someday',
  later: 'someday',
  sd: 'someday',
};

/** `~30`, `~30m`, `~30min`, `~1h`, `~1.5h`, `~1h30`, `~1h30m` → minutes. */
export function parseEstimate(token: string): number | null {
  const t = token.toLowerCase();
  let m = /^(\d+)(?:m|min)?$/.exec(t);
  if (m) return Number(m[1]);
  m = /^(\d+(?:\.\d+)?)h$/.exec(t);
  if (m) return Math.round(Number(m[1]) * 60);
  m = /^(\d+)h(\d+)(?:m|min)?$/.exec(t);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  return null;
}

/**
 * Parse shorthand typed into a title: `Call the bank #home !now ~15m`.
 * Unrecognised tokens stay in the title. The last occurrence of each token wins.
 */
export function parseQuickAdd(input: string): QuickAdd {
  const out: QuickAdd = { title: '', projectQuery: null, priority: null, estimateMinutes: null };
  const words: string[] = [];

  for (const word of input.split(/\s+/).filter(Boolean)) {
    if (word.length > 1 && word.startsWith('#')) {
      out.projectQuery = word.slice(1);
      continue;
    }
    if (word.startsWith('!')) {
      const p = PRIORITY_TOKENS[word.slice(1).toLowerCase()];
      if (p) {
        out.priority = p;
        continue;
      }
    }
    if (word.startsWith('~')) {
      const est = parseEstimate(word.slice(1));
      if (est !== null && est > 0 && est <= 24 * 60) {
        out.estimateMinutes = est;
        continue;
      }
    }
    words.push(word);
  }

  out.title = words.join(' ');
  return out;
}

const normalize = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/** Best project for a `#query`: exact name, then prefix, then substring (spaces/punctuation ignored). */
export function matchProject<P extends { name: string }>(query: string, projects: readonly P[]): P | null {
  const q = normalize(query);
  if (!q) return null;
  const named = projects.map((p) => ({ p, n: normalize(p.name) }));
  return (
    named.find((x) => x.n === q)?.p ??
    named.find((x) => x.n.startsWith(q))?.p ??
    named.find((x) => x.n.includes(q))?.p ??
    null
  );
}
