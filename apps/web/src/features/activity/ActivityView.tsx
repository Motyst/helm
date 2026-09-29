import { useEffect, useMemo, useState } from 'react';
import type { ActivityEntry } from '@helm/shared';
import { ApiError } from '../../lib/api.ts';
import { clockTime } from '../../lib/format.ts';
import { useActivity, useAllProjects, useTasks, useUndo } from '../../lib/queries.ts';
import { readHashParams, writeHashParams } from '../../lib/route.ts';
import { useToast } from '../../ui/Toast.tsx';
import { dayKey, dayLabel } from '../done/done-model.ts';
import { useEditor } from '../task-editor/EditorContext.tsx';
import { actorLabel, describeEntry, isAgent, mainTaskId } from './activity-model.ts';
import { LogTabs } from './LogTabs.tsx';
import '../done/done.css';
import './activity.css';

type Who = 'agents' | 'all';

/**
 * Everything that changed on the board, newest first, grouped by request. Starts with what
 * agents and the assistant did, since that's what might slip by unnoticed, and each step
 * can be undone while nothing has changed the same tasks since.
 */
export function ActivityView() {
  const [who, setWho] = useState<Who>(() => (readHashParams().get('who') === 'all' ? 'all' : 'agents'));
  const [taskId, setTaskId] = useState<string | null>(() => readHashParams().get('task'));
  const projects = useAllProjects();
  const tasks = useTasks();

  useEffect(() => {
    const params = new URLSearchParams();
    if (who === 'all') params.set('who', 'all');
    if (taskId) params.set('task', taskId);
    writeHashParams(params);
  }, [who, taskId]);

  const log = useActivity({ who: taskId ? 'all' : who, ...(taskId ? { taskId } : {}) });
  const names = useMemo(() => {
    const map = new Map((projects.data ?? []).map((p) => [p.id, p.name]));
    return (id: string | null) => (id ? (map.get(id) ?? 'a deleted project') : 'Inbox');
  }, [projects.data]);

  const now = new Date();
  const days = useMemo(() => {
    const out: { key: string; entries: ActivityEntry[] }[] = [];
    for (const e of log.data?.pages.flatMap((p) => p.entries) ?? []) {
      const key = dayKey(new Date(e.at));
      if (out.at(-1)?.key !== key) out.push({ key, entries: [] });
      out.at(-1)!.entries.push(e);
    }
    return out;
  }, [log.data]);

  const focusTask = taskId ? tasks.data?.find((t) => t.id === taskId) : undefined;
  const heading = taskId
    ? `Changes to ${focusTask ? `“${focusTask.title}”` : 'this task'}`
    : who === 'agents'
      ? 'What agents changed'
      : 'Every change';

  return (
    <main className="log activity">
      <LogTabs current="activity" />
      <header className="log-head">
        <h1 className="log-summary">{heading}</h1>
        <div className="log-filters">
          {taskId ? (
            <button className="btn" onClick={() => setTaskId(null)}>
              Show all tasks
            </button>
          ) : (
            <fieldset className="log-ranges">
              <legend className="visually-hidden">Whose changes</legend>
              <div className="chips">
                {(
                  [
                    ['agents', 'Agents and assistant'],
                    ['all', 'Everyone'],
                  ] as const
                ).map(([value, label]) => (
                  <label key={value} className="chip">
                    <input type="radio" name="activity-who" checked={who === value} onChange={() => setWho(value)} />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}
        </div>
      </header>

      {log.isError ? (
        <p className="log-empty">
          The activity didn’t load.{' '}
          <button className="link-btn" onClick={() => void log.refetch()}>
            Try again
          </button>
        </p>
      ) : !log.isPending && days.length === 0 ? (
        <p className="log-empty">
          {who === 'agents' && !taskId
            ? 'Nothing yet. When an agent or the assistant changes your board, it shows up here and you can undo it.'
            : 'No changes yet.'}
        </p>
      ) : (
        days.map((day) => (
          <section key={day.key} className="log-day" aria-labelledby={`act-${day.key}`}>
            <h2 className="log-date" id={`act-${day.key}`}>
              <span>{dayLabel(day.key, now)}</span>
            </h2>
            <ol className="log-entries">
              {day.entries.map((e) => (
                <Entry key={e.batchId} entry={e} names={names} onlyTask={Boolean(taskId)} onShowTask={setTaskId} />
              ))}
            </ol>
          </section>
        ))
      )}

      {log.hasNextPage && (
        <div className="log-more">
          <button className="btn" disabled={log.isFetchingNextPage} onClick={() => void log.fetchNextPage()}>
            {log.isFetchingNextPage ? 'Loading…' : 'Show older'}
          </button>
        </div>
      )}
    </main>
  );
}

function Entry({
  entry,
  names,
  onlyTask,
  onShowTask,
}: {
  entry: ActivityEntry;
  names: (id: string | null) => string;
  onlyTask: boolean;
  onShowTask: (id: string) => void;
}) {
  const undo = useUndo();
  const toast = useToast();
  const editor = useEditor();
  const tasks = useTasks();
  const lines = describeEntry(entry, names);
  if (lines.length === 0) return null;

  const agent = isAgent(entry.actor);
  const taskId = mainTaskId(entry);
  const open = taskId ? tasks.data?.find((t) => t.id === taskId && !t.deletedAt) : undefined;
  const [first, ...rest] = lines;

  const run = () => {
    if (entry.cantUndo) {
      toast({ message: `Can’t undo: ${entry.cantUndo}` });
      return;
    }
    undo.mutate(entry.batchId, {
      onSuccess: () => toast({ message: 'Undone.' }),
      onError: (err) => toast({ message: `Can’t undo: ${err instanceof ApiError ? err.message : 'something went wrong'}` }),
    });
  };

  return (
    <li className={`log-entry act-entry${entry.undoneAt ? ' is-undone' : ''}`}>
      <time className="log-time" dateTime={entry.at}>
        {clockTime(entry.at)}
      </time>
      <span className={`log-fix${agent ? ' act-fix-agent' : ''}`} aria-hidden />
      <div className="log-body">
        <p className="log-title">
          <span className={`act-who${agent ? ' is-agent' : ''}`}>{actorLabel(entry.actor)}</span> <Line line={first!} />
        </p>
        {rest.length > 0 && (
          <ul className="act-lines">
            {rest.map((l) => (
              <li key={l.key}>
                <Line line={l} />
              </li>
            ))}
          </ul>
        )}
        <p className="log-meta">
          {entry.undoOf && <span>Undid an earlier change</span>}
          {entry.undoneAt && <span className="act-undone">Undone</span>}
          {open && (
            <button type="button" className="link-btn" onClick={() => editor.openEdit(open.id)}>
              Open task
            </button>
          )}
          {taskId && !onlyTask && (
            <button type="button" className="link-btn" onClick={() => onShowTask(taskId)}>
              History
            </button>
          )}
        </p>
      </div>
      {!entry.undoneAt && (
        <button
          className={`btn btn-quiet log-reopen act-undo${entry.cantUndo ? ' is-blocked' : ''}`}
          aria-disabled={Boolean(entry.cantUndo) || undo.isPending}
          onClick={run}
          title={entry.cantUndo ?? 'Undo'}
        >
          <svg className="log-reopen-icon" viewBox="0 0 20 20" aria-hidden>
            <path d="M4.5 9.5a6 6 0 1 0 1.8-4.3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            <path d="M5.5 1.8v3.8h3.8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="log-reopen-text">Undo</span>
          <span className="visually-hidden">: {first!.text}</span>
        </button>
      )}
    </li>
  );
}

function Line({ line }: { line: ReturnType<typeof describeEntry>[number] }) {
  return (
    <>
      <span className="act-text">{line.text}</span>
      {line.alsoSubtasks > 0 && (
        <span className="act-also">
          {' '}
          and {line.alsoSubtasks} subtask{line.alsoSubtasks === 1 ? '' : 's'}
        </span>
      )}
      {line.details.length > 0 && (
        <span className="act-details">
          {line.details.map((d) => (
            <span key={d}>{d}</span>
          ))}
        </span>
      )}
    </>
  );
}
