import { useState } from 'react';
import type { Focus, TaskNode } from '@helm/shared';
import { clockTime, formatMinutes } from '../../lib/format.ts';
import { hrefFor } from '../../lib/route.ts';
import { ProjectLabel, type ProjectMap } from '../../ui/ProjectLabel.tsx';
import { TimerCard } from '../timer/TimerCard.tsx';
import { useTimerState } from '../timer/TimerContext.tsx';
import { CourseLine } from './CourseLine.tsx';
import { minutesLeft, vitalFew, working, type Working } from './focus-model.ts';
import './focus-layouts.css';

type Action = 'start' | 'stop' | 'complete' | 'reopen';

/** What every Focus layout gets from FocusView. */
export interface LayoutProps {
  focus: Focus;
  projects: ProjectMap;
  now: number;
  /** Open top-level tasks on the whole board. */
  openCount: number;
  run: (id: string, action: Action) => void;
  onEdit: (id: string) => void;
  onComplete: (task: TaskNode) => void;
  onAdd: () => void;
}

// ---------- A: one thing ----------

/** Only the task in progress: its time, its next step, and big buttons in thumb reach. */
export function FocusOne({ focus, projects, now, run, onEdit, onComplete, onAdd }: LayoutProps) {
  const { current, upNext } = focus;
  const [timerOpen, toggleTimer] = useTimerToggle();

  if (!current) return <Idle task={upNext} projects={projects} run={run} onEdit={onEdit} onAdd={onAdd} className="fx-one" />;

  const w = working(current, focus.activeSubtaskId, now);
  return (
    <main className="focus fx fx-one">
      <p className="fx-status">
        <span className="status-text">
          <span className="status-dot" aria-hidden="true" />
          {w.startedAt ? `Since ${clockTime(w.startedAt)}` : 'In progress'}
        </span>
        <ProjectLabel projectId={current.projectId} projects={projects} />
      </p>
      <h1 className="fx-title">
        <button className="fx-title-btn" onClick={() => onEdit(current.id)}>
          {current.title}
        </button>
      </h1>

      <div className="fx-clock">
        <p className="fx-clock-text">
          <strong>{w.elapsed < 60 ? w.elapsed : formatMinutes(w.elapsed)}</strong>
          <span>
            {w.elapsed < 60 ? 'min ' : ''}
            {w.estimate ? `of ${formatMinutes(w.estimate)} · ` : 'so far'}
            {w.left !== null && <b className={w.left < 0 ? 'is-over' : undefined}>{leftText(w.left)}</b>}
          </span>
        </p>
        {w.startedAt && <CourseLine elapsed={w.elapsed} estimate={w.estimate} />}
      </div>

      {w.step && <StepCard task={current} w={w} run={run} />}

      <span className="fx-spacer" />

      {timerOpen && <TimerCard label={current.title} taskId={current.id} />}
      {upNext && <ThenLine task={upNext} onEdit={onEdit} />}

      <div className="fx-actions">
        <button className="btn btn-primary fx-main" onClick={() => onComplete(current)}>
          Mark done
        </button>
        <button className="btn fx-round" aria-label="Pause" title="Pause" onClick={() => run(w.workingId, 'stop')}>
          <PauseIcon />
        </button>
        <button
          className="btn fx-round"
          aria-label="Timer"
          title="Timer"
          aria-pressed={timerOpen}
          onClick={toggleTimer}
        >
          <TimerIcon />
        </button>
      </div>
    </main>
  );
}

// ---------- C: vital three ----------

/** The three tasks that matter most, numbered; everything else folded into one link. */
export function FocusVital({ focus, projects, now, openCount, run, onEdit, onComplete, onAdd }: LayoutProps) {
  const { timer } = useTimerState();
  const few = vitalFew(focus);
  if (few.length === 0) return <Idle task={null} projects={projects} run={run} onEdit={onEdit} onAdd={onAdd} className="fx-vital" />;

  const { current } = focus;
  const w = current ? working(current, focus.activeSubtaskId, now) : null;
  const left = minutesLeft(few, w, current?.id ?? null);
  const rest = openCount - few.length;
  const heading = ['', 'The one thing', 'The vital two', 'The vital three'][few.length];

  return (
    <main className="focus fx fx-vital">
      <header className="fx-vital-head">
        <h1 className="fx-display">{heading}</h1>
        <p className="fx-sub">
          {few.length} of {openCount} open {openCount === 1 ? 'task' : 'tasks'}
          {left > 0 && ` · about ${formatMinutes(left)}`}
        </p>
      </header>

      <ol className="fx-vital-list">
        {few.map((t, i) =>
          t.id === current?.id && w ? (
            <li key={t.id} className="fx-vital-item is-current">
              <div className="fx-vital-row">
                <span className="fx-num">{i + 1}</span>
                <div className="fx-vital-main">
                  <h2 className="fx-vital-title">
                    <button className="fx-title-btn" onClick={() => onEdit(t.id)}>
                      {t.title}
                    </button>
                  </h2>
                  <p className="fx-vital-meta">
                    <ProjectLabel projectId={t.projectId} projects={projects} />
                    <span>{w.estimate ? `${w.elapsed} of ${formatMinutes(w.estimate)}` : `${formatMinutes(w.elapsed)} so far`}</span>
                  </p>
                  {w.step && (
                    <button className="fx-vital-step" onClick={() => run(w.step!.id, 'complete')}>
                      <span className="fx-box" aria-hidden="true" />
                      <span>
                        <span className="visually-hidden">Tick off the next step: </span>
                        {w.step.title}
                      </span>
                    </button>
                  )}
                </div>
              </div>
              {w.startedAt && <CourseLine elapsed={w.elapsed} estimate={w.estimate} />}
              <div className="fx-vital-actions">
                <button className="btn fx-invert" onClick={() => onComplete(t)}>
                  Mark done
                </button>
                <button className="btn fx-invert-quiet" onClick={() => run(w.workingId, 'stop')}>
                  Pause
                </button>
              </div>
            </li>
          ) : (
            <li key={t.id} className="fx-vital-item">
              <div className="fx-vital-row">
                <span className="fx-num">{i + 1}</span>
                <div className="fx-vital-main">
                  <h2 className="fx-vital-title">
                    <button className="fx-title-btn" onClick={() => onEdit(t.id)}>
                      {t.title}
                    </button>
                  </h2>
                  <p className="fx-vital-meta">
                    <ProjectLabel projectId={t.projectId} projects={projects} />
                    {t.estimateMinutes && <span>{formatMinutes(t.estimateMinutes)}</span>}
                    {t.progress && (
                      <span>
                        {t.progress.done}/{t.progress.total}
                      </span>
                    )}
                  </p>
                </div>
                <button
                  className={`btn ${!current && i === 0 ? 'btn-primary' : ''}`}
                  onClick={() => run(t.id, 'start')}
                  aria-label={`Start ${t.title}`}
                >
                  Start
                </button>
              </div>
            </li>
          ),
        )}
      </ol>

      <span className="fx-spacer" />

      {/* No timer button here, but a running one stays in view. */}
      {timer && <TimerCard label={current?.title ?? null} taskId={current?.id ?? null} />}
      {rest > 0 && (
        <a className="fx-rest" href={hrefFor('board')}>
          <span>
            <strong>{rest} more</strong> can wait
          </span>
          <span>Board</span>
        </a>
      )}
    </main>
  );
}

// ---------- D: compass ----------

const RING_R = 120;
const RING_C = 2 * Math.PI * RING_R;

/** A countdown ring, the task, and three round buttons. */
export function FocusCompass({ focus, projects, now, run, onEdit, onComplete, onAdd }: LayoutProps) {
  const { current, upNext } = focus;
  const [timerOpen, toggleTimer] = useTimerToggle();
  const w = current ? working(current, focus.activeSubtaskId, now) : null;

  // With an estimate the ring counts it down; without one it fills over an hour.
  const share = !w ? 0 : w.estimate ? Math.min(w.elapsed / w.estimate, 1) : Math.min(w.elapsed / 60, 1);
  const over = w?.left !== null && w?.left !== undefined && w.left < 0;
  const big = !w ? null : w.left === null ? w.elapsed : Math.abs(w.left);
  const unit = !w
    ? ''
    : w.left === null
      ? 'min so far'
      : over
        ? 'min over'
        : `min left of ${formatMinutes(w.estimate!)}`;

  return (
    <main className="focus fx fx-compass">
      <span className="fx-spacer" />
      <div className={`fx-ring${over ? ' is-over' : ''}`}>
        <svg viewBox="0 0 272 272" role="img" aria-label={w ? `${big} ${unit}` : 'Nothing in progress'}>
          <circle className="fx-ring-track" cx="136" cy="136" r={RING_R} />
          {w && (
            <circle
              className="fx-ring-run"
              cx="136"
              cy="136"
              r={RING_R}
              strokeDasharray={`${Math.max(share * RING_C, 1)} ${RING_C}`}
              transform="rotate(-90 136 136)"
            />
          )}
        </svg>
        <div className="fx-ring-text" aria-hidden="true">
          {w ? (
            <>
              <strong className={big !== null && big >= 100 ? 'is-long' : undefined}>{big}</strong>
              <span>{unit}</span>
            </>
          ) : (
            <span>{upNext ? 'Up next' : 'All clear'}</span>
          )}
        </div>
      </div>
      <span className="fx-spacer" />

      {current && w ? (
        <>
          <p className="fx-compass-project">
            <ProjectLabel projectId={current.projectId} projects={projects} />
          </p>
          <h1 className="fx-display fx-compass-title">
            <button className="fx-title-btn" onClick={() => onEdit(current.id)}>
              {current.title}
            </button>
          </h1>
          {w.step && (
            <button className="fx-chip" onClick={() => run(w.step!.id, 'complete')}>
              <span className="fx-box" aria-hidden="true" />
              <span>
                <span className="visually-hidden">Tick off the next step: </span>
                {w.step.title}
              </span>
              <span className="fx-chip-count">
                {w.stepNumber}/{current.subtasks.length}
              </span>
            </button>
          )}
          <span className="fx-spacer" />
          {timerOpen && <TimerCard label={current.title} taskId={current.id} />}
          <div className="fx-compass-actions">
            <button className="btn fx-round" aria-label="Pause" title="Pause" onClick={() => run(w.workingId, 'stop')}>
              <PauseIcon />
            </button>
            <button className="fx-done" onClick={() => onComplete(current)}>
              <CheckIcon />
              Done
            </button>
            <button className="btn fx-round" aria-label="Timer" title="Timer" aria-pressed={timerOpen} onClick={toggleTimer}>
              <TimerIcon />
            </button>
          </div>
          {upNext && <ThenLine task={upNext} onEdit={onEdit} centered />}
        </>
      ) : upNext ? (
        <>
          <h1 className="fx-display fx-compass-title">
            <button className="fx-title-btn" onClick={() => onEdit(upNext.id)}>
              {upNext.title}
            </button>
          </h1>
          <p className="fx-compass-project">
            <ProjectLabel projectId={upNext.projectId} projects={projects} />
            {upNext.estimateMinutes && <span>{formatMinutes(upNext.estimateMinutes)}</span>}
          </p>
          <span className="fx-spacer" />
          <div className="fx-compass-actions">
            <button className="fx-done" onClick={() => run(upNext.id, 'start')}>
              <PlayIcon />
              Start
            </button>
          </div>
        </>
      ) : (
        <>
          <h1 className="fx-display fx-compass-title">Nothing on Now or Soon.</h1>
          <span className="fx-spacer" />
          <div className="fx-compass-actions">
            <button className="fx-done" onClick={onAdd}>
              <PlusIcon />
              Add
            </button>
          </div>
        </>
      )}
    </main>
  );
}

// ---------- Shared pieces ----------

function leftText(left: number): string {
  return left < 0 ? `${formatMinutes(-left)} over` : `${formatMinutes(left)} left`;
}

/** The timer shows while one runs, or when asked for. */
function useTimerToggle(): [boolean, () => void] {
  const { timer } = useTimerState();
  const [asked, setAsked] = useState(false);
  return [asked || timer !== null, () => setAsked((a) => !a)];
}

function StepCard({ task, w, run }: { task: TaskNode; w: Working; run: LayoutProps['run'] }) {
  return (
    <button className="fx-step" onClick={() => run(w.step!.id, 'complete')}>
      <span className="fx-box" aria-hidden="true" />
      <span className="fx-step-text">
        <span className="fx-kicker">
          Next step · {w.stepNumber} of {task.subtasks.length}
        </span>
        <span className="fx-step-title">
          <span className="visually-hidden">Tick off: </span>
          {w.step!.title}
        </span>
      </span>
    </button>
  );
}

function ThenLine({ task, onEdit, centered = false }: { task: TaskNode; onEdit: LayoutProps['onEdit']; centered?: boolean }) {
  return (
    <button className={`fx-then${centered ? ' is-centered' : ''}`} onClick={() => onEdit(task.id)}>
      <span className="fx-then-label">Then</span>
      <span className="fx-then-title">{task.title}</span>
      {task.estimateMinutes && <span>{formatMinutes(task.estimateMinutes)}</span>}
    </button>
  );
}

/** Nothing in progress: what's next with a big Start, or an empty board. */
function Idle({
  task,
  projects,
  run,
  onEdit,
  onAdd,
  className,
}: {
  task: TaskNode | null;
  projects: ProjectMap;
  run: LayoutProps['run'];
  onEdit: LayoutProps['onEdit'];
  onAdd: () => void;
  className: string;
}) {
  return (
    <main className={`focus fx ${className}`}>
      <span className="fx-spacer" />
      {task ? (
        <>
          <p className="fx-status">Nothing in progress. Next up:</p>
          <h1 className="fx-title">
            <button className="fx-title-btn" onClick={() => onEdit(task.id)}>
              {task.title}
            </button>
          </h1>
          <p className="fx-status">
            <ProjectLabel projectId={task.projectId} projects={projects} />
            {task.estimateMinutes && <span>{formatMinutes(task.estimateMinutes)}</span>}
          </p>
        </>
      ) : (
        <>
          <h1 className="fx-title">Nothing on Now or Soon.</h1>
          <p className="fx-status">Tasks you add, or that an agent adds, show up here.</p>
        </>
      )}
      <span className="fx-spacer" />
      <div className="fx-actions">
        {task ? (
          <button className="btn btn-primary fx-main" onClick={() => run(task.id, 'start')}>
            Start
          </button>
        ) : (
          <button className="btn btn-primary fx-main" onClick={onAdd}>
            Add a task
          </button>
        )}
      </div>
    </main>
  );
}

const PauseIcon = () => (
  <svg viewBox="0 0 22 22" aria-hidden="true">
    <path d="M8 5v12M14 5v12" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
  </svg>
);
const TimerIcon = () => (
  <svg viewBox="0 0 22 22" aria-hidden="true">
    <circle cx="11" cy="12.5" r="7" fill="none" stroke="currentColor" strokeWidth="2" />
    <path d="M11 12.5V9M8.5 2.5h5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);
const CheckIcon = () => (
  <svg viewBox="0 0 34 34" aria-hidden="true">
    <path d="M8 18l6 6 12-14" fill="none" stroke="currentColor" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const PlayIcon = () => (
  <svg viewBox="0 0 34 34" aria-hidden="true">
    <path d="M12 8l14 9-14 9z" fill="currentColor" />
  </svg>
);
const PlusIcon = () => (
  <svg viewBox="0 0 34 34" aria-hidden="true">
    <path d="M17 8v18M8 17h18" fill="none" stroke="currentColor" strokeWidth="3.6" strokeLinecap="round" />
  </svg>
);
