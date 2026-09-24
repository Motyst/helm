import { PRIORITIES, type MoveTaskInput, type Priority, type Task, type TaskNode } from '@helm/shared';

/** Bin key: a project id, or "inbox" for tasks without a project. */
export const INBOX_KEY = 'inbox';
export const binKey = (projectId: string | null) => projectId ?? INBOX_KEY;
export const binProjectId = (key: string) => (key === INBOX_KEY ? null : key);

/** A drop container is one priority group inside one bin: `${binKey}:${priority}`. */
export const containerId = (bin: string, priority: Priority) => `${bin}:${priority}`;
/** Collapsed bins accept drops on their header: `bin:${binKey}`. */
export const binDropId = (bin: string) => `bin:${bin}`;

export function parseContainer(id: string): { bin: string; priority: Priority } | null {
  const i = id.lastIndexOf(':');
  if (i <= 0 || id.startsWith('bin:')) return null;
  const priority = id.slice(i + 1) as Priority;
  if (!PRIORITIES.includes(priority)) return null;
  return { bin: id.slice(0, i), priority };
}

/** Ordered task ids per container. */
export type Columns = Record<string, string[]>;

/** Group open top-level tasks into every bin × priority container (empty ones included). */
export function buildColumns(roots: readonly TaskNode[], bins: readonly string[]): Columns {
  const cols: Columns = {};
  for (const b of bins) for (const p of PRIORITIES) cols[containerId(b, p)] = [];
  for (const t of roots) {
    const id = containerId(binKey(t.projectId), t.priority);
    cols[id]?.push(t.id); // roots arrive sorted by position
  }
  return cols;
}

/** The container holding `id`, or `id` itself when it is a container. */
export function findContainer(cols: Columns, id: string): string | undefined {
  if (id in cols) return id;
  return Object.keys(cols).find((c) => cols[c]!.includes(id));
}

/**
 * Live preview while dragging across containers: move `activeId` next to `overId`
 * (a task, a container, or a collapsed bin header). Same container → no change here;
 * reordering within a container happens on drop.
 */
export function moveAcross(cols: Columns, activeId: string, overId: string, fallbackPriority: Priority): Columns {
  const from = findContainer(cols, activeId);
  let to: string | undefined;
  if (overId.startsWith('bin:')) to = containerId(overId.slice(4), fallbackPriority);
  else to = findContainer(cols, overId);
  if (!from || !to || from === to || !(to in cols)) return cols;

  const target = cols[to]!.filter((id) => id !== activeId);
  const overIndex = target.indexOf(overId);
  target.splice(overIndex === -1 ? target.length : overIndex, 0, activeId);
  return { ...cols, [from]: cols[from]!.filter((id) => id !== activeId), [to]: target };
}

/** Reorder within one container (arrayMove semantics). */
export function reorderWithin(cols: Columns, activeId: string, overId: string): Columns {
  const c = findContainer(cols, activeId);
  if (!c || findContainer(cols, overId) !== c || activeId === overId) return cols;
  const list = cols[c]!.slice();
  const from = list.indexOf(activeId);
  // Dropped on the container itself (e.g. its empty tail): move to the end.
  const to = overId === c ? list.length - 1 : list.indexOf(overId);
  list.splice(from, 1);
  list.splice(to, 0, activeId);
  return { ...cols, [c]: list };
}

/**
 * Turn the final layout into the server move request for `task`, or null if nothing changed.
 * Neighbours are the tasks directly above/below it in its new container.
 */
export function moveInputFor(cols: Columns, task: Task, before: Columns): MoveTaskInput | null {
  const c = findContainer(cols, task.id);
  if (!c) return null;
  const parsed = parseContainer(c);
  if (!parsed) return null;

  const list = cols[c]!;
  const i = list.indexOf(task.id);
  const afterId = list[i - 1] ?? null;
  const beforeId = list[i + 1] ?? null;

  const input: MoveTaskInput = {};
  const projectId = binProjectId(parsed.bin);
  if (projectId !== task.projectId) input.projectId = projectId;
  if (parsed.priority !== task.priority) input.priority = parsed.priority;

  const prevC = findContainer(before, task.id);
  const prevList = prevC ? before[prevC]! : [];
  const prevI = prevList.indexOf(task.id);
  const orderChanged =
    prevC !== c || (prevList[prevI - 1] ?? null) !== afterId || (prevList[prevI + 1] ?? null) !== beforeId;
  if (orderChanged && (afterId || beforeId)) {
    if (afterId) input.afterId = afterId;
    if (beforeId) input.beforeId = beforeId;
  }
  return Object.keys(input).length ? input : null;
}
