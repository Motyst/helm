import type { z } from 'zod';

export type ErrorCode = 'invalid' | 'unauthorized' | 'forbidden' | 'not_found' | 'conflict';

export class HelmError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'HelmError';
  }
}

export const notFound = (what: string) => new HelmError('not_found', `${what} not found`);
export const forbidden = (msg = 'Not allowed') => new HelmError('forbidden', msg);
export const invalid = (msg: string, details?: unknown) => new HelmError('invalid', msg, details);

/** Parse with a zod schema, converting failures to a HelmError('invalid'). */
export function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const r = schema.safeParse(input);
  if (!r.success) {
    const details = r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    throw invalid(details.map((d) => (d.path ? `${d.path}: ${d.message}` : d.message)).join('; '), details);
  }
  return r.data;
}
