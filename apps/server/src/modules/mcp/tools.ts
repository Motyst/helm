import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { buildTree, INBOX, matchProject, PRIORITIES, type Priority, type Task, type TaskNode } from '@helm/shared';
import { z } from 'zod';
import type { Config } from '../../config.ts';
import type { Principal } from '../../core/auth/principal.ts';
import { HelmError, invalid } from '../../core/errors.ts';
import type { Services } from '../../core/services/index.ts';

const Id = z.string().min(1).max(64);
const TaskId = Id.describe('Task id, from list_tasks, get_focus or get_task');
const ProjectArg = z
  .string()
  .min(1)
  .max(100)
  .describe('Project name or id. "Inbox" means no project. Names match loosely (prefix or part of the name).');
const PriorityArg = z.enum(PRIORITIES).describe('now = doing today, soon = this week, someday = later');
const Minutes = z.number().int().min(1).max(1440);

const READ = { readOnlyHint: true, openWorldHint: false } as const;
const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;

function text(data: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

/** Service errors become tool errors the model can read and act on. */
function run(fn: () => unknown): CallToolResult {
  try {
    return text(fn());
  } catch (err) {
    if (err instanceof HelmError) {
      return { isError: true, content: [{ type: 'text', text: `${err.code}: ${err.message}` }] };
    }
    console.error(err);
    return { isError: true, content: [{ type: 'text', text: 'internal: something went wrong on the server' }] };
  }
}

function agentName(p: Principal): string {
  return p.kind === 'token' ? p.name : 'owner';
}

/**
 * One MCP server per request, bound to the caller's principal: every tool goes through the
 * same services as the REST API, so token scopes apply unchanged. Read-only tokens are not
 * offered the write tools at all.
 */
export function buildMcpServer(services: Services, p: Principal, config: Config): McpServer {
  const canWrite = p.kind === 'owner' || p.scope === 'read_write';
  const limit = config.rules.inProgressLimit;

  const server = new McpServer(
    { name: 'helm', version: '0.1.0' },
    {
      instructions: [
        'Helm is the user’s personal task board, shown on their screens as they work.',
        'Tasks have a priority (now, soon, someday), a status (todo, in_progress, done), an optional estimate in minutes and at most one level of subtasks. Tasks without a project live in the Inbox.',
        limit > 0
          ? `At most ${limit} task(s) can be in progress; starting another pauses the one started longest ago.`
          : 'Any number of tasks can be in progress.',
        'Call get_focus first to see what the user is working on. Only mark tasks done or change priorities when the user asked or clearly finished the work.',
        canWrite
          ? `Tasks you create are labelled as added by "${agentName(p)}".`
          : 'This connection is read-only.',
      ].join(' '),
    },
  );

  // ---------- Views ----------

  const projectNames = () =>
    new Map(services.projects.list(p, { includeArchived: 'true' }).map((x) => [x.id, x.name]));

  const view = (t: Task, names: Map<string, string>, subtasks?: readonly Task[]) => ({
    id: t.id,
    title: t.title,
    status: t.status,
    priority: t.priority,
    project: t.projectId ? (names.get(t.projectId) ?? 'unknown project') : 'Inbox',
    projectId: t.projectId,
    estimateMinutes: t.estimateMinutes,
    ...(t.notes ? { notes: t.notes } : {}),
    ...(t.parentTaskId ? { parentTaskId: t.parentTaskId } : {}),
    ...(subtasks && subtasks.length > 0
      ? {
          progress: `${subtasks.filter((s) => s.status === 'done').length}/${subtasks.length} subtasks done`,
          subtasks: subtasks.map((s) => ({ id: s.id, title: s.title, status: s.status })),
        }
      : {}),
    ...(t.status === 'in_progress' && t.startedAt ? { startedAt: t.startedAt } : {}),
    ...(t.completedAt ? { completedAt: t.completedAt } : {}),
    addedBy: t.source,
  });

  const nodeView = (n: TaskNode, names: Map<string, string>) => view(n, names, n.subtasks);

  /** undefined = not given, null = Inbox, else a project id the caller can see. */
  const resolveProject = (arg: string | undefined): string | null | undefined => {
    if (arg === undefined) return undefined;
    if (arg.trim().toLowerCase() === INBOX) return null;
    const projects = services.projects.list(p);
    const hit = projects.find((x) => x.id === arg) ?? matchProject(arg, projects);
    if (!hit) {
      const known = ['Inbox', ...projects.map((x) => x.name)].join(', ');
      throw invalid(`No project matches "${arg}". Projects: ${known}`);
    }
    return hit.id;
  };

  const withSubtasks = (t: Task) => view(t, projectNames(), services.tasks.subtasks(p, t.id));

  // ---------- Read ----------

  server.registerTool(
    'get_focus',
    {
      title: 'What the user is doing now',
      description:
        'The task in progress (with its subtasks), what is up next, and the rest of the Now list. Start here.',
      annotations: READ,
    },
    () =>
      run(() => {
        const f = services.tasks.focus(p);
        const names = projectNames();
        return {
          inProgress: f.current ? nodeView(f.current, names) : null,
          activeSubtaskId: f.activeSubtaskId,
          alsoInProgress: f.alsoInProgress.map((n) => nodeView(n, names)),
          upNext: f.upNext ? nodeView(f.upNext, names) : null,
          restOfNow: f.now.map((n) => nodeView(n, names)),
        };
      }),
  );

  server.registerTool(
    'list_tasks',
    {
      title: 'List open tasks',
      description:
        'Open (not done) tasks with their subtasks, ordered by priority and then by the user’s own order. Filter by project, priority, status or text.',
      inputSchema: {
        project: ProjectArg.optional(),
        priority: PriorityArg.optional(),
        status: z.enum(['todo', 'in_progress']).optional(),
        query: z.string().max(200).optional().describe('Case-insensitive text to find in titles and notes'),
      },
      annotations: READ,
    },
    (args) =>
      run(() => {
        const projectId = resolveProject(args.project);
        const q = args.query?.toLowerCase();
        const rank = (x: Priority) => PRIORITIES.indexOf(x);
        const names = projectNames();
        return buildTree(services.tasks.board(p))
          .filter((n) => n.status !== 'done')
          .filter((n) => projectId === undefined || n.projectId === projectId)
          .filter((n) => !args.priority || n.priority === args.priority)
          .filter((n) => !args.status || n.status === args.status)
          .filter((n) => !q || `${n.title}\n${n.notes ?? ''}`.toLowerCase().includes(q))
          .sort((a, b) => rank(a.priority) - rank(b.priority))
          .map((n) => nodeView(n, names));
      }),
  );

  server.registerTool(
    'get_task',
    {
      title: 'Get a task',
      description: 'One task with its notes and all of its subtasks, done or not.',
      inputSchema: { id: TaskId },
      annotations: READ,
    },
    ({ id }) => run(() => withSubtasks(services.tasks.get(p, id))),
  );

  server.registerTool(
    'list_projects',
    {
      title: 'List projects',
      description: 'Projects the user sorts tasks into, with how many open tasks each has. The Inbox holds tasks without a project.',
      annotations: READ,
    },
    () =>
      run(() => {
        const open = buildTree(services.tasks.board(p)).filter((n) => n.status !== 'done');
        const count = (id: string | null) => open.filter((n) => n.projectId === id).length;
        const projects = services.projects.list(p).map((x) => ({ id: x.id, name: x.name, openTasks: count(x.id) }));
        const inboxVisible = p.kind === 'owner' || p.projectIds === null;
        return inboxVisible ? [{ id: null, name: 'Inbox', openTasks: count(null) }, ...projects] : projects;
      }),
  );

  server.registerTool(
    'list_done',
    {
      title: 'List finished tasks',
      description: 'Tasks marked done recently, newest first.',
      inputSchema: {
        project: ProjectArg.optional(),
        days: z.number().int().min(1).max(365).default(7).describe('How many days back to look'),
        include_subtasks: z.boolean().default(false),
        limit: z.number().int().min(1).max(200).default(50),
      },
      annotations: READ,
    },
    (args) =>
      run(() => {
        const projectId = resolveProject(args.project);
        const from = new Date(Date.now() - args.days * 86_400_000).toISOString();
        const page = services.tasks.doneLog(p, {
          from,
          limit: String(args.limit),
          includeSubtasks: String(args.include_subtasks),
          ...(projectId === undefined ? {} : { projectId: projectId ?? INBOX }),
        });
        const names = projectNames();
        return { tasks: page.tasks.map((t) => view(t, names)), more: page.nextCursor !== null };
      }),
  );

  if (!canWrite) return server;

  // ---------- Write ----------

  server.registerTool(
    'create_task',
    {
      title: 'Add a task',
      description:
        'Add a task, optionally with subtasks. Without a project it goes to the Inbox; without a priority it is "soon". Pass parent_task_id to add a single subtask to an existing task instead.',
      inputSchema: {
        title: z.string().min(1).max(500),
        notes: z.string().max(10_000).optional(),
        project: ProjectArg.optional(),
        priority: PriorityArg.optional(),
        estimate_minutes: Minutes.optional(),
        parent_task_id: Id.optional().describe('Make this a subtask of that task (inherits its project)'),
        subtasks: z.array(z.string().min(1).max(500)).max(50).optional().describe('Titles of subtasks to add'),
      },
      annotations: WRITE,
    },
    (args) =>
      run(() => {
        const projectId = resolveProject(args.project);
        const task = services.tasks.create(p, {
          title: args.title,
          notes: args.notes,
          projectId: projectId ?? null,
          priority: args.priority,
          estimateMinutes: args.estimate_minutes,
          parentTaskId: args.parent_task_id,
          subtasks: args.subtasks?.map((title) => ({ title })),
        });
        return withSubtasks(task);
      }),
  );

  server.registerTool(
    'update_task',
    {
      title: 'Edit a task',
      description: 'Change a task’s title, notes, priority, estimate or project. Only the fields you pass change.',
      inputSchema: {
        id: TaskId,
        title: z.string().min(1).max(500).optional(),
        notes: z.string().max(10_000).nullable().optional().describe('null clears the notes'),
        priority: PriorityArg.optional(),
        estimate_minutes: Minutes.nullable().optional().describe('null clears the estimate'),
        project: ProjectArg.optional().describe('Move to this project ("Inbox" for none); subtasks follow'),
      },
      annotations: { ...WRITE, idempotentHint: true },
    },
    (args) =>
      run(() => {
        const projectId = resolveProject(args.project);
        const task = services.tasks.update(p, args.id, {
          ...(args.title !== undefined ? { title: args.title } : {}),
          ...(args.notes !== undefined ? { notes: args.notes } : {}),
          ...(args.priority !== undefined ? { priority: args.priority } : {}),
          ...(args.estimate_minutes !== undefined ? { estimateMinutes: args.estimate_minutes } : {}),
          ...(projectId !== undefined ? { projectId } : {}),
        });
        return withSubtasks(task);
      }),
  );

  const statusTool = (
    name: string,
    title: string,
    description: string,
    action: 'start' | 'stop' | 'complete' | 'reopen',
  ) =>
    server.registerTool(
      name,
      { title, description, inputSchema: { id: TaskId }, annotations: { ...WRITE, idempotentHint: true } },
      ({ id }) => run(() => withSubtasks(services.tasks[action](p, id))),
    );

  statusTool(
    'start_task',
    'Start a task',
    'Mark a task as in progress, so it shows as the focus. Starting a subtask also starts its parent.',
    'start',
  );
  statusTool('pause_task', 'Pause a task', 'Move an in-progress task back to todo.', 'stop');
  statusTool(
    'complete_task',
    'Mark a task done',
    'Mark a task done. Completing a task also completes its open subtasks. Only do this when the work is finished.',
    'complete',
  );
  statusTool('reopen_task', 'Reopen a task', 'Put a done task back to todo.', 'reopen');

  server.registerTool(
    'move_task',
    {
      title: 'Move a task',
      description:
        'Change a task’s project or priority, or reorder it. To reorder, give the task it should go right after or right before (a task in the same list).',
      inputSchema: {
        id: TaskId,
        project: ProjectArg.optional(),
        priority: PriorityArg.optional(),
        after_task_id: Id.optional(),
        before_task_id: Id.optional(),
      },
      annotations: { ...WRITE, idempotentHint: true },
    },
    (args) =>
      run(() => {
        const projectId = resolveProject(args.project);
        const task = services.tasks.move(p, args.id, {
          ...(projectId !== undefined ? { projectId } : {}),
          ...(args.priority ? { priority: args.priority } : {}),
          ...(args.after_task_id ? { afterId: args.after_task_id } : {}),
          ...(args.before_task_id ? { beforeId: args.before_task_id } : {}),
        });
        return withSubtasks(task);
      }),
  );

  return server;
}
