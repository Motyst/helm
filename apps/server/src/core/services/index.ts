import type { ServiceContext } from './context.ts';
import { ProjectService } from './project.service.ts';
import { TaskService } from './task.service.ts';
import { TokenService } from './token.service.ts';

export interface Services {
  tasks: TaskService;
  projects: ProjectService;
  tokens: TokenService;
}

export function createServices(ctx: ServiceContext): Services {
  return {
    tasks: new TaskService(ctx),
    projects: new ProjectService(ctx),
    tokens: new TokenService(ctx),
  };
}

export type { ServiceContext } from './context.ts';
export { TaskService, ProjectService, TokenService };
