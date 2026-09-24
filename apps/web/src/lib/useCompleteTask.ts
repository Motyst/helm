import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import type { Task } from '@helm/shared';
import { useToast } from '../ui/Toast.tsx';
import { api } from './api.ts';
import { keys, upsertTask } from './queries.ts';

/**
 * Mark a task done and offer Undo. Completing a parent also completes its open subtasks,
 * so Undo reopens exactly those too.
 */
export function useCompleteTask() {
  const qc = useQueryClient();
  const toast = useToast();

  return useCallback(
    async (task: Task) => {
      const openSubs = (qc.getQueryData<Task[]>(keys.tasks) ?? []).filter(
        (t) => t.parentTaskId === task.id && t.status !== 'done' && !t.deletedAt,
      );
      try {
        upsertTask(qc, await api.taskAction(task.id, 'complete'));
      } catch (err) {
        toast({ message: `Couldn’t mark done: ${(err as Error).message}` });
        return;
      }
      toast({
        message: `Marked done: ${task.title}`,
        action: {
          label: 'Undo',
          run: async () => {
            upsertTask(qc, await api.taskAction(task.id, 'reopen'));
            for (const s of openSubs) upsertTask(qc, await api.taskAction(s.id, 'reopen'));
          },
        },
      });
    },
    [qc, toast],
  );
}
