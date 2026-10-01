import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import type { Task } from '@helm/shared';
import { useToast } from '../ui/Toast.tsx';
import { api } from './api.ts';
import { keys, upsertTask } from './queries.ts';

/**
 * Delete a task (and its subtasks) and offer Undo, which brings back exactly what this
 * deleted. Throws if the delete fails, so the caller can show the error in place.
 */
export function useDeleteTask() {
  const qc = useQueryClient();
  const toast = useToast();

  return useCallback(
    async (task: Task) => {
      upsertTask(qc, await api.deleteTask(task.id));
      toast({
        message: `Deleted: ${task.title}`,
        action: {
          label: 'Undo',
          run: async () => {
            try {
              upsertTask(qc, await api.taskAction(task.id, 'restore'));
              // The subtasks come back too; their live events may lag, so refetch.
              void qc.invalidateQueries({ queryKey: keys.tasks });
            } catch (err) {
              toast({ message: `Couldn’t undo: ${(err as Error).message}` });
            }
          },
        },
      });
    },
    [qc, toast],
  );
}
