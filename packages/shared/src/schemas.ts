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

// ---------- Realtime ----------

export const EVENT_ENTITIES = ['task', 'project'] as const;
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
  /** Full snapshot of the entity after the change. */
  data: Task | Project;
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
