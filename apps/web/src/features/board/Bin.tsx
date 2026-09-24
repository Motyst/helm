import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import type { CSSProperties } from 'react';
import { PRIORITIES, type Priority, type Project, type TaskNode } from '@helm/shared';
import { formatMinutes } from '../../lib/format.ts';
import { binDropId, containerId } from './board-model.ts';
import { SortableTaskCard, type CardActions } from './TaskCard.tsx';

const PRIORITY_LABEL: Record<Priority, string> = { now: 'Now', soon: 'Soon', someday: 'Someday' };

interface BinProps extends CardActions {
  bin: string;
  /** null for the Inbox. */
  project: Project | null;
  /** Task ids per priority, in display order. */
  groups: Record<Priority, string[]>;
  nodes: Map<string, TaskNode>;
  collapsed: boolean;
  dragging: boolean;
  onToggleCollapsed: () => void;
  onAdd: (priority?: Priority) => void;
  onEditProject?: () => void;
}

export function Bin(props: BinProps) {
  const { bin, project, groups, nodes, collapsed, dragging } = props;
  const ids = PRIORITIES.flatMap((p) => groups[p]);
  const minutes = ids.reduce((sum, id) => sum + (nodes.get(id)?.estimateMinutes ?? 0), 0);
  const name = project?.name ?? 'Inbox';
  const header = useDroppable({ id: binDropId(bin), disabled: !collapsed });
  const bodyId = `bin-body-${bin}`;

  return (
    <section
      className={`bin ${collapsed ? 'is-collapsed' : ''} ${header.isOver ? 'is-drop-target' : ''} ${project ? '' : 'is-inbox'}`}
      style={project ? ({ '--bin': project.color } as CSSProperties) : undefined}
      aria-label={name}
    >
      <header className="bin-head" ref={header.setNodeRef}>
        <button
          className="bin-toggle"
          aria-expanded={!collapsed}
          aria-controls={bodyId}
          onClick={props.onToggleCollapsed}
        >
          <span className="bin-chevron" aria-hidden="true" />
          <h2 className="bin-name">{name}</h2>
        </button>
        <span className="bin-stats">
          {ids.length} {ids.length === 1 ? 'task' : 'tasks'}
          {minutes > 0 && `, ${formatMinutes(minutes)}`}
        </span>
        <span className="bin-tools">
          <button className="icon-btn" aria-label={`Add task to ${name}`} onClick={() => props.onAdd()}>
            +
          </button>
          {props.onEditProject && (
            <button className="icon-btn" aria-label={`Edit project ${name}`} onClick={props.onEditProject}>
              …
            </button>
          )}
        </span>
      </header>

      {!collapsed && (
        <div className="bin-body" id={bodyId}>
          {ids.length === 0 && !dragging ? (
            <p className="bin-empty">
              Nothing here yet.{' '}
              <button className="link-btn" onClick={() => props.onAdd()}>
                Add a task
              </button>
            </p>
          ) : (
            PRIORITIES.map((p) =>
              groups[p].length > 0 || dragging ? (
                <Group key={p} id={containerId(bin, p)} label={PRIORITY_LABEL[p]} ids={groups[p]} {...props} />
              ) : null,
            )
          )}
        </div>
      )}
    </section>
  );
}

function Group({ id, label, ids, nodes, ...actions }: BinProps & { id: string; label: string; ids: string[] }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div className={`group ${ids.length === 0 ? 'is-empty' : ''} ${isOver ? 'is-over' : ''}`}>
      <h3 className="group-label">
        {label}
        {ids.length > 0 && <span className="group-count">{ids.length}</span>}
      </h3>
      <SortableContext id={id} items={ids} strategy={verticalListSortingStrategy}>
        <ul className="group-list" ref={setNodeRef}>
          {ids.map((taskId) => {
            const node = nodes.get(taskId);
            return node ? (
              <SortableTaskCard
                key={taskId}
                task={node}
                onEdit={actions.onEdit}
                onComplete={actions.onComplete}
                onToggleSubtask={actions.onToggleSubtask}
              />
            ) : null;
          })}
        </ul>
      </SortableContext>
    </div>
  );
}
