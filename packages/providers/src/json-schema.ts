import { z } from 'zod';

type Json = { [k: string]: unknown };

const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * JSON Schema for "strict" structured output: every object closed and every key required
 * (vendors that enforce the schema need both). Zod's safe-integer bounds are dropped as noise.
 */
export function toStrictJsonSchema(schema: z.ZodType): Json {
  const { $schema: _drop, ...root } = z.toJSONSchema(schema, { io: 'output' }) as Json;
  return close(root) as Json;
}

function close(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(close);
  if (!isObj(node)) return node;
  const out: Json = {};
  for (const [k, v] of Object.entries(node)) {
    if ((k === 'minimum' || k === 'maximum') && Math.abs(v as number) === Number.MAX_SAFE_INTEGER) continue;
    out[k] = close(v);
  }
  if (out.type === 'object' && isObj(out.properties)) {
    out.additionalProperties = false;
    out.required = Object.keys(out.properties);
  }
  return out;
}
