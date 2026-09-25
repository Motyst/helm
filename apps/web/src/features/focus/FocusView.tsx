import { useEffect, useMemo, useState } from 'react';
import { computeFocus, type Task, type TaskNode } from '@helm/shared';
import { clockTime, formatMinutes, minutesSince } from '../../lib/format.ts';
import { useProjects, useTaskAction, useTasks } from '../../lib/queries.ts';
import { useCompleteTask } from '../../lib/useCompleteTask.ts';
import { ProjectLabel, type ProjectMap } from '../../ui/ProjectLabel.tsx';
import { useEditor } from '../task-editor/EditorContext.tsx';
import { CourseLine } from './CourseLine.tsx';
import './focus.css';

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function FocusView() {
  const tasks = useTasks();
  const projects = useProjects();
  const action = useTaskAction();
  const editor = useEditor();
  const complete = useCompleteTask();
  const now = useNow(30_000);

  const focus = useMemo(() => computeFocus(tasks.data ?? []), [tasks.data]);
  const projectMap: ProjectMap = useMemo(() => new Map((projects.data ?? []).map((p) => [p.id, p])), [projects.data]);

  if (tasks.isPending) return <main className="focus" aria-busy="true" />;
  if (tasks.isError) {
    return (
      <main className="focus focus-message">
        <p>Couldn’t load tasks: {tasks.error.message}</p>
      </main>
    );
  }

  const run = (id: string, a: 'start' | 'stop' | 'complete' | 'reopen') => action.mutate({ id, action: a });
  const { current, upNext } = focus;
  const queue = focus.now;
  const queueMinutes = queue.reduce((sum, t) => sum + (t.estimateMinutes ?? 0), 0);

  return (
    <main className="focus">
      <section className="focus-hero" aria-label={current ? 'In progress' : 'Nothing in progress'}>
        {current ? (
          <CurrentTask
            task={current}
            activeSubtaskId={focus.activeSubtaskId}
            projects={projectMap}
            now={now}
            onAction={run}
            onEdit={() => editor.openEdit(current.id)}
            onComplete={() => void complete(current)}
          />
        ) : upNext ? (
          <div className="hero-idle">
            <p className="hero-note">Nothing in progress. Next up:</p>
            <h1 className="hero-title hero-title-idle">{upNext.title}</h1>
            <div className="hero-meta">
              <ProjectLabel projectId={upNext.projectId} projects={projectMap} />
              {upNext.estimateMinutes && <span>{formatMinutes(upNext.estimateMinutes)}</span>}
              {upNext.progress && (
                <span>
                  {upNext.progress.done}/{upNext.progress.total} subtasks
                </span>
              )}
            </div>
            <div className="hero-actions">
              <button className="btn btn-primary" onClick={() => run(upNext.id, 'start')}>
                Start
              </button>
              <button className="btn btn-quiet" onClick={() => editor.openEdit(upNext.id)}>
                Edit
              </button>
            </div>
          </div>
        ) : (
          <div className="hero-idle">
            <h1 className="hero-title hero-title-idle">Nothing on Now or Soon.</h1>
            <p className="hero-note">Tasks you add, or that an agent adds, show up here.</p>
            <div className="hero-actions">
              <button className="btn btn-primary" onClick={() => editor.openCreate({ priority: 'now' })}>
                Add a task
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="focus-queue">
        {current && upNext && (
          <div className="queue-block">
            <h2 className="queue-heading">Up next</h2>
            <QueueRow task={upNext} projects={projectMap} onStart={() => run(upNext.id, 'start')} onEdit={() => editor.openEdit(upNext.id)} large />
          </div>
        )}

        {focus.alsoInProgress.length > 0 && (
          <div className="queue-block">
            <h2 className="queue-heading">Also in progress</h2>
            <ul className="queue-list">
              {focus.alsoInProgress.map((t) => (
                <li key={t.id}>
                  <QueueRow task={t} projects={projectMap} onStart={() => run(t.id, 'start')} onEdit={() => editor.openEdit(t.id)} />
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="queue-block">
          <h2 className="queue-heading">
            Now
            {queue.length > 0 && (
              <span className="queue-sum">
                {queue.length} {queue.length === 1 ? 'task' : 'tasks'}
                {queueMinutes > 0 && `, about ${formatMinutes(queueMinutes)}`}
              </span>
            )}
          </h2>
          {queue.length > 0 ? (
            <ul className="queue-list">
              {queue.map((t) => (
                <li key={t.id}>
                  <QueueRow task={t} projects={projectMap} onStart={() => run(t.id, 'start')} onEdit={() => editor.openEdit(t.id)} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="queue-empty">Nothing else on Now.</p>
          )}
        </div>
      </section>
    </main>
  );
}

function CurrentTask({
  task,
  activeSubtaskId,
  projects,
  now,
  onAction,
  onEdit,
  onComplete,
}: {
  task: TaskNode;
  activeSubtaskId: string | null;
  projects: ProjectMap;
  now: number;
  onAction: (id: string, a: 'start' | 'stop' | 'complete' | 'reopen') => void;
  onEdit: () => void;
  onComplete: () => void;
}) {
  const active = activeSubtaskId ? task.subtasks.find((s) => s.id === activeSubtaskId) : undefined;
  const startedAt = (active ?? task).startedAt;
  const elapsed = startedAt ? minutesSince(startedAt, now) : 0;
  const estimate = task.estimateMinutes;
  const workingId = active?.id ?? task.id;

  return (
    <div className="hero-current">
      <h1 className="hero-title">{task.title}</h1>
      {startedAt && <CourseLine elapsed={elapsed} estimate={estimate} />}
      <div className="hero-meta">
        <ProjectLabel projectId={task.projectId} projects={projects} />
        {startedAt && <span>Started {clockTime(startedAt)}</span>}
        <span className={estimate && elapsed > estimate ? 'over' : undefined}>
          {estimate ? `${formatMinutes(elapsed)} of ${formatMinutes(estimate)}` : `${formatMinutes(elapsed)} in`}
        </span>
        {task.progress && (
          <span>
            {task.progress.done}/{task.progress.total} subtasks
          </span>
        )}
      </div>

      {task.subtasks.length > 0 && (
        <ul className="subtasks">
          {task.subtasks.map((s) => (
            <li key={s.id} className={s.id === activeSubtaskId ? 'is-active' : undefined}>
              <button
                className={`check ${s.status === 'done' ? 'is-done' : ''}`}
                aria-pressed={s.status === 'done'}
                onClick={() => onAction(s.id, s.status === 'done' ? 'reopen' : 'complete')}
              >
                <span className="check-box" aria-hidden="true" />
                <span className="check-label">{s.title}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="hero-actions">
        <button className="btn btn-primary" onClick={onComplete}>
          Mark done
        </button>
        <button className="btn btn-quiet" onClick={() => onAction(workingId, 'stop')}>
          Pause
        </button>
        <button className="btn btn-quiet" onClick={onEdit}>
          Edit
        </button>
      </div>
    </div>
  );
}

function QueueRow({
  task,
  projects,
  onStart,
  onEdit,
  large = false,
}: {
  task: TaskNode | Task;
  projects: ProjectMap;
  onStart: () => void;
  onEdit: () => void;
  large?: boolean;
}) {
  const progress = 'progress' in task ? task.progress : null;
  return (
    <div className={`queue-row ${large ? 'queue-row-large' : ''}`}>
      <div className="queue-row-main">
        <button className="queue-title" onClick={onEdit}>
          {task.title}
        </button>
        <span className="queue-meta">
          <ProjectLabel projectId={task.projectId} projects={projects} />
          {task.estimateMinutes && <span>{formatMinutes(task.estimateMinutes)}</span>}
          {progress && (
            <span>
              {progress.done}/{progress.total}
            </span>
          )}
        </span>
      </div>
      <button className="btn btn-quiet queue-start" onClick={onStart} aria-label={`Start ${task.title}`}>
        Start
      </button>
    </div>
  );
}
