import { z } from 'zod';

const Env = z.object({
  HELM_PORT: z.coerce.number().int().default(8787),
  HELM_DB_PATH: z.string().default('./data/helm.db'),
  HELM_OWNER_PASSWORD: z.string().min(1, 'HELM_OWNER_PASSWORD is required'),
  HELM_SESSION_SECRET: z.string().min(16, 'HELM_SESSION_SECRET must be at least 16 chars'),
  HELM_COOKIE_SECURE: z.stringbool().default(false),
  HELM_IN_PROGRESS_LIMIT: z.coerce.number().int().min(0).default(1),
  HELM_MAX_SUBTASK_DEPTH: z.coerce.number().int().min(0).default(1),
  HELM_WEB_DIST: z.string().optional(),
});

export interface TaskRules {
  /** Max tasks in_progress at once; starting another demotes the oldest. 0 = unlimited. */
  inProgressLimit: number;
  /** 0 = no subtasks, 1 = subtasks can't have subtasks, ... */
  maxSubtaskDepth: number;
}

export interface Config {
  port: number;
  dbPath: string;
  ownerPassword: string;
  sessionSecret: string;
  cookieSecure: boolean;
  rules: TaskRules;
  /** Built web app to serve statically (production). */
  webDist?: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid configuration:\n${issues}\nSee .env.example.`);
  }
  const e = parsed.data;
  return {
    port: e.HELM_PORT,
    dbPath: e.HELM_DB_PATH,
    ownerPassword: e.HELM_OWNER_PASSWORD,
    sessionSecret: e.HELM_SESSION_SECRET,
    cookieSecure: e.HELM_COOKIE_SECURE,
    rules: { inProgressLimit: e.HELM_IN_PROGRESS_LIMIT, maxSubtaskDepth: e.HELM_MAX_SUBTASK_DEPTH },
    webDist: e.HELM_WEB_DIST,
  };
}
