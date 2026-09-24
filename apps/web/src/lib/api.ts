import type {
  CreateProjectInput,
  CreateTaskInput,
  MoveTaskInput,
  Project,
  Task,
  UpdateProjectInput,
  UpdateTaskInput,
} from '@helm/shared';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (!res.ok) {
    const err = data?.error ?? {};
    throw new ApiError(res.status, err.code ?? 'error', err.message ?? res.statusText);
  }
  return data as T;
}

export type TaskAction = 'start' | 'stop' | 'complete' | 'reopen';

export const api = {
  me: () => request<{ signedIn: boolean }>('GET', '/auth/me'),
  login: (password: string) => request<{ ok: true }>('POST', '/auth/login', { password }),
  logout: () => request<{ ok: true }>('POST', '/auth/logout'),

  tasks: () => request<Task[]>('GET', '/tasks'),
  createTask: (input: CreateTaskInput) => request<Task>('POST', '/tasks', input),
  updateTask: (id: string, patch: UpdateTaskInput) => request<Task>('PATCH', `/tasks/${id}`, patch),
  deleteTask: (id: string) => request<Task>('DELETE', `/tasks/${id}`),
  taskAction: (id: string, action: TaskAction) => request<Task>('POST', `/tasks/${id}/${action}`),
  moveTask: (id: string, input: MoveTaskInput) => request<Task>('POST', `/tasks/${id}/move`, input),

  projects: () => request<Project[]>('GET', '/projects'),
  createProject: (input: CreateProjectInput) => request<Project>('POST', '/projects', input),
  updateProject: (id: string, patch: UpdateProjectInput) => request<Project>('PATCH', `/projects/${id}`, patch),
  archiveProject: (id: string) => request<Project>('DELETE', `/projects/${id}`),
};
