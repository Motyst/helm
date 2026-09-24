import {
  closestCorners,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type KeyboardCoordinateGetter,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { useCallback, useMemo, useRef, useState } from 'react';
import { buildTree, PRIORITIES, type Priority, type Project, type Task } from '@helm/shared';
import { useMoveTask, useProjects, useTaskAction, useTasks, useUpdateProject } from '../../lib/queries.ts';
import { useCompleteTask } from '../../lib/useCompleteTask.ts';
import { useToast } from '../../ui/Toast.tsx';
import { useEditor } from '../task-editor/EditorContext.tsx';
import {
  binDropId,
  binProjectId,
  buildColumns,
  containerId,
  findContainer,
  INBOX_KEY,
  moveAcross,
  moveInputFor,
  parseContainer,
  reorderWithin,
  type Columns,
} from './board-model.ts';
import { Bin } from './Bin.tsx';
import { ProjectDialog } from './ProjectDialog.tsx';
import { TaskCard } from './TaskCard.tsx';
import './board.css';

const INBOX_COLLAPSED_KEY = 'helm.inboxCollapsed';
const PRIORITY_LABEL: Record<Priority, string> = { now: 'Now', soon: 'Soon', someday: 'Someday' };

function readInboxCollapsed(): boolean {
  try {
    return localStorage.getItem(INBOX_COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

export function BoardView() {
  const tasks = useTasks();
  const projects = useProjects();
  const move = useMoveTask();
  const action = useTaskAction();
  const updateProject = useUpdateProject();
  const complete = useCompleteTask();
  const editor = useEditor();
  const toast = useToast();

  const [inboxCollapsed, setInboxCollapsed] = useState(readInboxCollapsed);
  const [projectDialog, setProjectDialog] = useState<{ project?: Project; key: number } | null>(null);

  const roots = useMemo(() => buildTree(tasks.data ?? []).filter((t) => t.status !== 'done'), [tasks.data]);
  const nodes = useMemo(() => new Map(roots.map((n) => [n.id, n])), [roots]);
  const bins = useMemo(() => [INBOX_KEY, ...(projects.data ?? []).map((p) => p.id)], [projects.data]);
  const base = useMemo(() => buildColumns(roots, bins), [roots, bins]);

  // While dragging: live layout. After drop: hold the dropped layout until the server confirms.
  const [dragCols, setDragCols] = useState<Columns | null>(null);
  const [pending, setPending] = useState<Columns | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const startCols = useRef<Columns>(base);
  const cols = dragCols ?? pending ?? base;

  // Read by the keyboard coordinate getter, which dnd-kit captures once.
  const live = useRef<{ cols: Columns; bins: string[]; isCollapsed: (bin: string) => boolean }>({
    cols,
    bins,
    isCollapsed: () => false,
  });
  live.current = {
    cols,
    bins,
    isCollapsed: (bin) =>
      bin === INBOX_KEY ? inboxCollapsed : Boolean(projects.data?.find((p) => p.id === bin)?.collapsed),
  };

  /** Up/Down: reorder within/between groups (dnd-kit default). Left/Right: jump to the neighbouring bin. */
  const keyboardCoordinates: KeyboardCoordinateGetter = useCallback((event, args) => {
    const dir = event.code === 'ArrowRight' ? 1 : event.code === 'ArrowLeft' ? -1 : 0;
    if (!dir) return sortableKeyboardCoordinates(event, args);
    const { cols, bins, isCollapsed } = live.current;
    const from = findContainer(cols, String(args.active));
    const parsed = from ? parseContainer(from) : null;
    if (!parsed) return undefined;
    const nextBin = bins[bins.indexOf(parsed.bin) + dir];
    if (!nextBin) return undefined;
    const target = isCollapsed(nextBin) ? binDropId(nextBin) : containerId(nextBin, parsed.priority);
    const rect = args.context.droppableRects.get(target);
    if (!rect) return undefined;
    event.preventDefault();
    return { x: rect.left + 4, y: rect.top + 4 };
  }, []);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: keyboardCoordinates }),
  );

  if (tasks.isPending || projects.isPending) return <main className="board" aria-busy="true" />;

  const activeTask = activeId ? nodes.get(activeId) : undefined;

  function onDragStart(e: DragStartEvent) {
    startCols.current = base;
    setDragCols(base);
    setActiveId(String(e.active.id));
  }

  function onDragOver({ active, over }: DragOverEvent) {
    if (!over) return;
    const task = nodes.get(String(active.id));
    if (!task) return;
    setDragCols((c) => moveAcross(c ?? base, task.id, String(over.id), task.priority));
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    const task = nodes.get(String(active.id));
    let final = dragCols ?? base;
    if (over && task) final = reorderWithin(final, task.id, String(over.id));
    setDragCols(null);
    setActiveId(null);
    if (!task) return;

    const input = moveInputFor(final, task, startCols.current);
    if (!input) return;
    setPending(final);
    move.mutate(
      { id: task.id, input },
      {
        onSettled: () => setPending(null),
        onError: (err) => toast({ message: `Couldn’t move “${task.title}”: ${err.message}` }),
      },
    );
  }

  function onDragCancel() {
    setDragCols(null);
    setActiveId(null);
  }

  function toggleCollapsed(bin: string) {
    const projectId = binProjectId(bin);
    if (projectId === null) {
      const next = !inboxCollapsed;
      setInboxCollapsed(next);
      try {
        localStorage.setItem(INBOX_COLLAPSED_KEY, next ? '1' : '0');
      } catch {
        /* private mode: keep in memory only */
      }
      return;
    }
    const p = projects.data?.find((x) => x.id === projectId);
    if (p) updateProject.mutate({ id: p.id, patch: { collapsed: !p.collapsed } });
  }

  const cardActions = {
    onEdit: (t: Task) => editor.openEdit(t.id),
    onComplete: (t: Task) => void complete(t),
    onToggleSubtask: (s: Task) => action.mutate({ id: s.id, action: s.status === 'done' ? 'reopen' : 'complete' }),
  };

  const groupsFor = (bin: string) =>
    Object.fromEntries(PRIORITIES.map((p) => [p, cols[containerId(bin, p)] ?? []])) as Record<Priority, string[]>;

  return (
    <main className="board">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={onDragCancel}
        accessibility={{
          announcements: {
            onDragStart: ({ active }) => `Picked up ${nodes.get(String(active.id))?.title ?? 'task'}.`,
            onDragOver: ({ over }) => (over ? `Over ${describeDrop(String(over.id), cols, projects.data ?? [])}.` : ''),
            onDragEnd: ({ over }) =>
              over ? `Dropped in ${describeDrop(String(over.id), cols, projects.data ?? [])}.` : 'Dropped.',
            onDragCancel: () => 'Move cancelled.',
          },
        }}
      >
        <div className="bins">
          {bins.map((bin) => {
            const project = projects.data?.find((p) => p.id === bin) ?? null;
            return (
              <Bin
                key={bin}
                bin={bin}
                project={project}
                groups={groupsFor(bin)}
                nodes={nodes}
                collapsed={project ? project.collapsed : inboxCollapsed}
                dragging={activeId !== null}
                onToggleCollapsed={() => toggleCollapsed(bin)}
                onAdd={(priority) => editor.openCreate({ projectId: binProjectId(bin), priority })}
                onEditProject={project ? () => setProjectDialog({ project, key: Date.now() }) : undefined}
                {...cardActions}
              />
            );
          })}
          <button className="bin-new" onClick={() => setProjectDialog({ key: Date.now() })}>
            New project
          </button>
        </div>

        <DragOverlay dropAnimation={prefersReducedMotion() ? null : undefined}>{activeTask ? <TaskCard task={activeTask} overlay {...cardActions} /> : null}</DragOverlay>
      </DndContext>

      {projectDialog && (
        <ProjectDialog key={projectDialog.key} project={projectDialog.project} onClose={() => setProjectDialog(null)} />
      )}
    </main>
  );
}

function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function describeDrop(overId: string, cols: Columns, projects: Project[]): string {
  const name = (bin: string) => projects.find((p) => p.id === bin)?.name ?? 'Inbox';
  if (overId.startsWith('bin:')) return name(overId.slice(4));
  const c = findContainer(cols, overId);
  if (!c) return 'the board';
  const parsed = parseContainer(c);
  return parsed ? `${name(parsed.bin)}, ${PRIORITY_LABEL[parsed.priority]}` : 'the board';
}

