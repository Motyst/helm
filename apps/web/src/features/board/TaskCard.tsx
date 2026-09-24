import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useState, type KeyboardEvent } from 'react';
import type { Task, TaskNode } from '@helm/shared';
import { formatMinutes } from '../../lib/format.ts';

export interface CardActions {
  onEdit: (task: Task) => void;
  onComplete: (task: Task) => void;
  onToggleSubtask: (sub: Task) => void;
}

interface CardProps extends CardActions {
  task: TaskNode;
  /** Rendered inside the drag overlay: no sortable wiring, lifted look. */
  overlay?: boolean;
}

export function TaskCard({ task, overlay = false, onEdit, onComplete, onToggleSubtask }: CardProps) {
  const [open, setOpen] = useState(false);
  const active = task.status === 'in_progress' || task.subtasks.some((s) => s.status === 'in_progress');

  return (
    <article className={`card ${active ? 'is-active' : ''} ${overlay ? 'is-overlay' : ''}`}>
      <button
        className="card-check"
        aria-label={`Mark done: ${task.title}`}
        onClick={() => onComplete(task)}
        tabIndex={overlay ? -1 : 0}
      />
      <div className="card-body">
        <button className="card-title" onClick={() => onEdit(task)} tabIndex={overlay ? -1 : 0}>
          {task.title}
        </button>
        <div className="card-meta">
          {active && <span className="card-live">In progress</span>}
          {task.estimateMinutes && <span>{formatMinutes(task.estimateMinutes)}</span>}
          {task.progress && (
            <button
              className="card-subs-toggle"
              aria-expanded={open}
              onClick={() => setOpen((o) => !o)}
              tabIndex={overlay ? -1 : 0}
            >
              <span className="progress-pips" aria-hidden="true">
                {task.subtasks.map((s) => (
                  <i key={s.id} className={s.status === 'done' ? 'on' : undefined} />
                ))}
              </span>
              {task.progress.done}/{task.progress.total}
              <span className="visually-hidden"> subtasks done. {open ? 'Hide' : 'Show'} subtasks</span>
            </button>
          )}
        </div>
        {open && !overlay && (
          <ul className="card-subs">
            {task.subtasks.map((s) => (
              <li key={s.id}>
                <label className={s.status === 'done' ? 'is-done' : undefined}>
                  <input
                    type="checkbox"
                    checked={s.status === 'done'}
                    onChange={() => onToggleSubtask(s)}
                  />
                  <span>{s.title}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>
    </article>
  );
}

/** A card that can be dragged within and between groups/bins. */
export function SortableTaskCard(props: CardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.task.id,
  });
  const { onKeyDown, ...pointerListeners } = listeners ?? {};

  return (
    <li
      ref={setNodeRef}
      className={`card-slot ${isDragging ? 'is-placeholder' : ''}`}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      {...attributes}
      aria-roledescription="draggable task"
      aria-label={`${props.task.title}. Press space to move.`}
      {...pointerListeners}
      // Keyboard drag only from the card itself, not when Enter/Space hits a button inside it.
      onKeyDown={(e: KeyboardEvent<HTMLLIElement>) => {
        if (e.target === e.currentTarget) onKeyDown?.(e);
      }}
    >
      <TaskCard {...props} />
    </li>
  );
}
