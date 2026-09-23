import type { Context } from 'hono';
import type { Principal } from '../core/auth/principal.ts';
import { invalid } from '../core/errors.ts';

export interface AppEnv {
  Variables: {
    principal: Principal;
  };
}

/** Read a JSON body; empty body = {}. */
export async function jsonBody(c: Context): Promise<unknown> {
  const text = await c.req.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw invalid('Body must be valid JSON');
  }
}
