import type { ServiceContext } from './context.ts';
import { ProjectService } from './project.service.ts';
import { TaskService } from './task.service.ts';

export interface Services {
  tasks: TaskService;
  projects: ProjectService;
}

export function createServices(ctx: ServiceContext): Services {
  return {
    tasks: new TaskService(ctx),
    projects: new ProjectService(ctx),
  };
}

export type { ServiceContext } from './context.ts';
export { TaskService, ProjectService };
