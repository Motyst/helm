import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type { HelmEvent, Project, Task } from '@helm/shared';
import { keys, upsertProject, upsertTask } from './queries.ts';

export type SyncState = 'connecting' | 'live' | 'offline';

/**
 * Keeps the query cache in step with the server over SSE. EventSource reconnects on its own
 * and resends Last-Event-ID, so missed events are replayed by the server.
 */
export function useLiveSync(enabled: boolean): SyncState {
  const qc = useQueryClient();
  const [state, setState] = useState<SyncState>('connecting');

  useEffect(() => {
    if (!enabled) return;
    const es = new EventSource('/api/v1/events');
    const refetchAll = () => {
      void qc.invalidateQueries({ queryKey: keys.tasks });
      void qc.invalidateQueries({ queryKey: keys.projects });
    };

    es.addEventListener('open', () => setState('live'));
    es.addEventListener('error', () => setState(es.readyState === EventSource.CLOSED ? 'offline' : 'connecting'));
    // Fresh connection or too far behind: take a new snapshot.
    es.addEventListener('ready', refetchAll);
    es.addEventListener('reset', refetchAll);
    es.addEventListener('change', (msg) => {
      const e = JSON.parse((msg as MessageEvent<string>).data) as HelmEvent;
      if (e.entity === 'task') upsertTask(qc, e.data as Task);
      else upsertProject(qc, e.data as Project);
      // A snapshot request in flight may predate this event; fetch again once it lands.
      const key = e.entity === 'task' ? keys.tasks : keys.projects;
      if (qc.isFetching({ queryKey: key }) > 0) void qc.invalidateQueries({ queryKey: key });
    });

    return () => es.close();
  }, [enabled, qc]);

  return state;
}
