import { z } from 'zod';

// ---------- Enums ----------

export const PRIORITIES = ['now', 'soon', 'someday'] as const;
export const Priority = z.enum(PRIORITIES);
export type Priority = z.infer<typeof Priority>;

export const TASK_STATUSES = ['todo', 'in_progress', 'done'] as const;
export const TaskStatus = z.enum(TASK_STATUSES);
export type TaskStatus = z.infer<typeof TaskStatus>;

/** `manual`, `voice`, or `ai:<agent>` (agent = short slug). */
export const TaskSource = z
  .string()
  .regex(/^(manual|voice|ai:[a-z0-9][a-z0-9._-]{0,63})$/, 'source must be manual, voice or ai:<agent>');
export type TaskSource = z.infer<typeof TaskSource>;

export const Id = z.string().min(1).max(64);
export const HexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'color must be #rrggbb');

// ---------- Entities (API shape, camelCase, ISO timestamps) ----------

export const Task = z.object({
  id: Id,
  title: z.string(),
  notes: z.string().nullable(),
  projectId: Id.nullable(),
  priority: Priority,
  estimateMinutes: z.number().int().nullable(),
  status: TaskStatus,
  parentTaskId: Id.nullable(),
  position: z.string(),
  source: TaskSource,
  createdAt: z.string(),
  updatedAt: z.string(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  deletedAt: z.string().nullable(),
});
export type Task = z.infer<typeof Task>;

export const Project = z.object({
  id: Id,
  name: z.string(),
  color: HexColor,
  collapsed: z.boolean(),
  position: z.string(),
  archivedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Project = z.infer<typeof Project>;

// ---------- Inputs ----------

const Title = z.string().trim().min(1, 'title is required').max(500);
const Notes = z.string().max(20_000).nullable();
const Estimate = z.number().int().min(1).max(24 * 60).nullable();

export const CreateTaskInput = z.object({
  title: Title,
  notes: Notes.optional(),
  projectId: Id.nullable().optional(),
  priority: Priority.optional(),
  estimateMinutes: Estimate.optional(),
  parentTaskId: Id.nullable().optional(),
  source: TaskSource.optional(),
  /** Create subtasks in the same step (same transaction). */
  subtasks: z
    .array(z.object({ title: Title, estimateMinutes: Estimate.optional() }))
    .max(50)
    .optional(),
});
export type CreateTaskInput = z.input<typeof CreateTaskInput>;

export const UpdateTaskInput = z
  .object({
    title: Title,
    notes: Notes,
    projectId: Id.nullable(),
    priority: Priority,
    estimateMinutes: Estimate,
    status: TaskStatus,
  })
  .partial()
  .strict();
export type UpdateTaskInput = z.input<typeof UpdateTaskInput>;

/**
 * Reposition a task (drag & drop). `afterId` = the task it should sit below,
 * `beforeId` = the task it should sit above. Either, both or neither may be given.
 */
export const MoveTaskInput = z
  .object({
    projectId: Id.nullable().optional(),
    priority: Priority.optional(),
    afterId: Id.nullable().optional(),
    beforeId: Id.nullable().optional(),
  })
  .strict();
export type MoveTaskInput = z.input<typeof MoveTaskInput>;

export const CreateProjectInput = z.object({
  name: z.string().trim().min(1).max(100),
  color: HexColor.optional(),
});
export type CreateProjectInput = z.input<typeof CreateProjectInput>;

export const UpdateProjectInput = z
  .object({
    name: z.string().trim().min(1).max(100),
    color: HexColor,
    collapsed: z.boolean(),
  })
  .partial()
  .strict();
export type UpdateProjectInput = z.input<typeof UpdateProjectInput>;

export const MoveProjectInput = z
  .object({
    afterId: Id.nullable().optional(),
    beforeId: Id.nullable().optional(),
  })
  .strict();
export type MoveProjectInput = z.input<typeof MoveProjectInput>;

/** Project filter value: a project id, or "inbox" for tasks without a project. */
export const INBOX = 'inbox' as const;

export const DoneLogQuery = z.object({
  projectId: Id.optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  includeSubtasks: z.stringbool().optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
  /** Opaque `nextCursor` from the previous page. */
  cursor: z
    .string()
    .regex(/^\d+:[^:]+$/, 'cursor must come from a previous page')
    .optional(),
});
export type DoneLogQuery = z.input<typeof DoneLogQuery>;

/** Newest first. `nextCursor` is null on the last page. */
export interface DoneLogPage {
  tasks: Task[];
  nextCursor: string | null;
}

export const ProjectListQuery = z.object({
  includeArchived: z.stringbool().optional(),
});
export type ProjectListQuery = z.input<typeof ProjectListQuery>;

// ---------- API tokens ----------

export const TOKEN_SCOPES = ['read', 'read_write'] as const;
export const TokenScope = z.enum(TOKEN_SCOPES);
export type TokenScope = z.infer<typeof TokenScope>;

/** A token as the owner sees it. The secret itself is shown once, at creation, and never stored. */
export const ApiToken = z.object({
  id: Id,
  name: z.string(),
  /** Start of the secret, to tell tokens apart. */
  prefix: z.string(),
  scope: TokenScope,
  /** null = every project and the Inbox. */
  projectIds: z.array(Id).nullable(),
  createdAt: z.string(),
  lastUsedAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
});
export type ApiToken = z.infer<typeof ApiToken>;

export const CreateTokenInput = z
  .object({
    /** Who uses it, e.g. "Claude Code". Becomes the task source `ai:<slug>`. */
    name: z.string().trim().min(1).max(64),
    scope: TokenScope,
    projectIds: z.array(Id).min(1).max(100).nullable().default(null),
    expiresInDays: z.number().int().min(1).max(3650).nullable().default(null),
  })
  .strict();
export type CreateTokenInput = z.input<typeof CreateTokenInput>;

export interface CreatedToken {
  token: ApiToken;
  /** Plain secret. Returned only by the create call. */
  secret: string;
}

// ---------- Voice ----------

/** What the server can do with voice; the app falls back to the browser's speech recognition. */
export interface VoiceStatus {
  /** Server can turn audio into text. */
  transcribe: boolean;
  /** Server can turn text into task fields with an AI model. */
  parse: boolean;
  /** Why a feature is off, in words for the user. */
  reasons: { transcribe?: string; parse?: string };
  /** Longest recording the server accepts. */
  maxSeconds: number;
}

export const VoiceTextInput = z
  .object({
    text: z.string().trim().min(1, 'text is required').max(5000),
  })
  .strict();
export type VoiceTextInput = z.input<typeof VoiceTextInput>;

/** A task suggested from speech. Nothing is saved until the user confirms it. */
export interface TaskSuggestion {
  title: string;
  notes: string | null;
  projectId: string | null;
  /** A project name that was heard but doesn't exist yet. */
  unmatchedProject: string | null;
  /** null = not said. */
  priority: Priority | null;
  estimateMinutes: number | null;
  subtasks: string[];
}

export interface VoiceParseResult {
  transcript: string;
  /** At least one. */
  tasks: TaskSuggestion[];
  /** false = no AI model (or it failed); the transcript became the title as is. */
  parsed: boolean;
  /** Why parsing was skipped when a model is set up but failed, for the user. */
  notice?: string;
}

// ---------- Assistant ----------

/** Put tasks in this order (and optionally set priorities). Only top-level tasks. */
export const ArrangeItems = z
  .array(z.object({ id: Id, priority: Priority.optional() }).strict())
  .min(1)
  .max(500);

export const ArrangeTasksInput = z.object({ items: ArrangeItems }).strict();
export type ArrangeTasksInput = z.input<typeof ArrangeTasksInput>;

/** One change the assistant proposed and the user accepted. Deleting is deliberately absent. */
export const AssistantChange = z.union([
  z
    .object({
      action: z.literal('create'),
      title: Title,
      notes: Notes.optional(),
      projectId: Id.nullable().optional(),
      priority: Priority.optional(),
      estimateMinutes: Estimate.optional(),
      parentTaskId: Id.nullable().optional(),
      subtasks: z.array(Title).max(50).optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('update'),
      taskId: Id,
      title: Title.optional(),
      notes: Notes.optional(),
      projectId: Id.nullable().optional(),
      priority: Priority.optional(),
      estimateMinutes: Estimate.optional(),
    })
    .strict(),
  z.object({ action: z.enum(['start', 'stop', 'complete', 'reopen']), taskId: Id }).strict(),
  z.object({ action: z.literal('arrange'), items: ArrangeItems }).strict(),
]);
export type AssistantChange = z.infer<typeof AssistantChange>;

export const ApplyChangesInput = z.object({ changes: z.array(AssistantChange).min(1).max(50) }).strict();
export type ApplyChangesInput = z.input<typeof ApplyChangesInput>;

export interface ApplyResult {
  /** One per change, in order. A failed change doesn't stop the rest. */
  results: { ok: boolean; error?: string }[];
}

export interface AssistantStatus {
  available: boolean;
  /** Why not, in words for the user. */
  reason?: string;
}

/** A suggested working order for open top-level tasks, first = do first. */
export interface PrioritySuggestion {
  /** One or two sentences on the overall reasoning. */
  summary: string;
  items: { taskId: string; priority: Priority; reason: string | null }[];
}

export const AssistantChatInput = z
  .object({
    messages: z
      .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().trim().min(1).max(8000) }).strict())
      .min(1)
      .max(40),
  })
  .strict();
export type AssistantChatInput = z.input<typeof AssistantChatInput>;

/** Lines of the chat stream (NDJSON). */
export type ChatStreamEvent =
  | { type: 'text'; delta: string }
  | { type: 'proposal'; summary: string; changes: AssistantChange[] }
  | { type: 'error'; message: string }
  | { type: 'done' };

// ---------- Realtime ----------

export const EVENT_ENTITIES = ['task', 'project', 'token'] as const;
export type EventEntity = (typeof EVENT_ENTITIES)[number];

export interface HelmEvent {
  id: number;
  at: string;
  /** `owner` or `token:<name>` */
  actor: string;
  entity: EventEntity;
  entityId: string;
  /** created | updated | moved | started | stopped | completed | reopened | deleted | archived */
  action: string;
  /** Full snapshot of the entity after the change. Token events reach the owner only. */
  data: Task | Project | ApiToken;
}

// ---------- Defaults ----------

export const PROJECT_COLORS = [
  '#6E8BFF', // periwinkle
  '#3FB68B', // jade
  '#E7A93B', // amber
  '#E26D6D', // coral
  '#A57BE0', // lilac
  '#3BB4C9', // teal
  '#D9779F', // rose
  '#8C9A5B', // olive
] as const;
