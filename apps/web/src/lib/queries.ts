import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from '@tanstack/react-query';
import type { DoneLogPage, MoveTaskInput, Project, Task, UpdateProjectInput } from '@helm/shared';
import { api, type DoneQuery, type TaskAction } from './api.ts';

export const keys = {
  tasks: ['tasks'] as const,
  projects: ['projects'] as const,
  done: ['done'] as const,
};

export const useTasks = () => useQuery({ queryKey: keys.tasks, queryFn: api.tasks });
const liveProjects = (ps: Project[]) => ps.filter((p) => !p.archivedAt);
/** Active projects. Archived ones stay in the cache (live events upsert them) but are filtered out here. */
export const useProjects = () => useQuery({ queryKey: keys.projects, queryFn: api.projects, select: liveProjects });
/** Including archived projects (for labelling old tasks). */
export const useAllProjects = () => useQuery({ queryKey: keys.projects, queryFn: api.projects });

const DONE_PAGE = 100;

/** Done log, newest first, loaded a page at a time. */
export function useDoneLog(query: Omit<DoneQuery, 'cursor' | 'limit'>) {
  return useInfiniteQuery({
    queryKey: [...keys.done, query],
    queryFn: ({ pageParam }) => api.done({ ...query, limit: DONE_PAGE, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

function inDoneLog(qc: QueryClient, id: string): boolean {
  return qc
    .getQueriesData<InfiniteData<DoneLogPage>>({ queryKey: keys.done })
    .some(([, data]) => data?.pages.some((pg) => pg.tasks.some((t) => t.id === id)));
}

const doneRefresh = new WeakMap<QueryClient, ReturnType<typeof setTimeout>>();

/** Completing a parent emits one event per subtask; refetch the log once after the burst. */
function refreshDoneLog(qc: QueryClient) {
  clearTimeout(doneRefresh.get(qc));
  doneRefresh.set(
    qc,
    setTimeout(() => void qc.invalidateQueries({ queryKey: keys.done }), 150),
  );
}

/** Insert or replace an entity in a cached list (used by mutations and live events). */
export function upsert<T extends { id: string; updatedAt: string }>(qc: QueryClient, key: readonly unknown[], item: T) {
  qc.setQueryData<T[]>(key, (list) => {
    if (!list) return list;
    const i = list.findIndex((x) => x.id === item.id);
    if (i === -1) return [...list, item];
    // Ignore stale snapshots (e.g. a late HTTP response after a newer live event).
    if (list[i]!.updatedAt > item.updatedAt) return list;
    const next = list.slice();
    next[i] = item;
    return next;
  });
}

export function upsertTask(qc: QueryClient, task: Task) {
  upsert(qc, keys.tasks, task);
  // Entered or left the log (or changed while in it).
  if (task.status === 'done' || inDoneLog(qc, task.id)) refreshDoneLog(qc);
}

export function upsertProject(qc: QueryClient, project: Project) {
  upsert(qc, keys.projects, project);
}

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.createProject,
    onSuccess: (p) => upsertProject(qc, p),
  });
}

export function useTaskAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: TaskAction }) => api.taskAction(id, action),
    onSuccess: (task) => upsertTask(qc, task),
  });
}

export function useMoveTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: MoveTaskInput }) => api.moveTask(id, input),
    onSuccess: (task) => upsertTask(qc, task),
  });
}

export function useUpdateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateProjectInput }) => api.updateProject(id, patch),
    // Optimistic: collapse/expand should feel instant.
    onMutate: ({ id, patch }) => {
      const p = qc.getQueryData<Project[]>(keys.projects)?.find((x) => x.id === id);
      // Keep the old updatedAt so the server response (newer) always wins.
      if (p) upsertProject(qc, { ...p, ...patch });
    },
    onSuccess: (p) => upsertProject(qc, p),
    onError: () => qc.invalidateQueries({ queryKey: keys.projects }),
  });
}

export function useArchiveProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.archiveProject,
    onSuccess: (p) => {
      upsertProject(qc, p);
      // Its tasks leave the board; refetch rather than patch each one.
      void qc.invalidateQueries({ queryKey: keys.tasks });
    },
  });
}
