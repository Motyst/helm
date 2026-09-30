import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { PROJECT_COLORS, type Project } from '@helm/shared';
import { ApiError } from '../../lib/api.ts';
import { LineInput } from '../../ui/LineInput.tsx';
import {
  useArchiveProject,
  useCreateProject,
  useDeleteProject,
  useMoveProject,
  useProjects,
  useTasks,
  useUpdateProject,
} from '../../lib/queries.ts';
import '../task-editor/editor.css';
import { ICON_CHOICES, autoIcon } from './project-icon.ts';

const COLOR_NAMES = ['Periwinkle', 'Jade', 'Amber', 'Coral', 'Lilac', 'Teal', 'Rose', 'Olive'];

/** Create a project (project = undefined) or rename / recolor / re-icon / reorder / archive / delete one. */
export function ProjectDialog({ project, onClose }: { project?: Project; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const nameId = useId();
  const create = useCreateProject();
  const update = useUpdateProject();
  const archive = useArchiveProject();
  const remove = useDeleteProject();
  const move = useMoveProject();
  const projects = useProjects().data ?? [];
  const tasks = useTasks().data ?? [];
  const [name, setName] = useState(project?.name ?? '');
  const [color, setColor] = useState<string>(project?.color ?? PROJECT_COLORS[0]);
  /** null = pick one from the name. */
  const [icon, setIcon] = useState<string | null>(project?.icon ?? null);
  const [customIcon, setCustomIcon] = useState(project?.icon && !ICON_CHOICES.includes(project.icon) ? project.icon : '');
  const auto = autoIcon(name);
  const [confirm, setConfirm] = useState<'archive' | 'delete' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = create.isPending || update.isPending || archive.isPending || remove.isPending;

  // Live order, so the buttons keep working after each move.
  const index = project ? projects.findIndex((p) => p.id === project.id) : -1;
  const openTasks = project
    ? tasks.filter((t) => t.projectId === project.id && !t.parentTaskId && t.status !== 'done' && !t.deletedAt).length
    : 0;

  useEffect(() => {
    if (ref.current && !ref.current.open) ref.current.showModal();
  }, []);

  // Tell the parent directly; the native `close` event (kept for Escape) can arrive late or not at all.
  const close = () => {
    ref.current?.close();
    onClose();
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError('Give the project a name.');
    try {
      if (project) await update.mutateAsync({ id: project.id, patch: { name: name.trim(), color, icon } });
      else await create.mutateAsync({ name: name.trim(), color, icon });
      close();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Couldn’t save the project.');
    }
  }

  async function doArchive() {
    if (!project) return;
    if (confirm !== 'archive') return setConfirm('archive');
    try {
      await archive.mutateAsync(project.id);
      close();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Couldn’t archive the project.');
    }
  }

  async function doDelete() {
    if (!project) return;
    if (confirm !== 'delete') return setConfirm('delete');
    try {
      await remove.mutateAsync(project.id);
      close();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Couldn’t delete the project.');
    }
  }

  /** -1 = one place earlier on the board, 1 = one place later. */
  function shift(dir: -1 | 1) {
    const neighbour = projects[index + dir];
    if (!project || !neighbour) return;
    setError(null);
    move.mutate(
      { id: project.id, input: dir === -1 ? { beforeId: neighbour.id } : { afterId: neighbour.id } },
      { onError: (err) => setError(err instanceof ApiError ? err.message : 'Couldn’t move the project.') },
    );
  }

  return (
    <dialog
      ref={ref}
      className="editor editor-small"
      aria-labelledby="project-heading"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) close();
      }}
    >
      <form className="editor-form" autoComplete="off" onSubmit={submit}>
        <header className="editor-head">
          <h2 id="project-heading">{project ? 'Edit project' : 'New project'}</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={close}>
            ✕
          </button>
        </header>

        <div className="field">
          {/* "Project", not "Name": Chrome would offer a person's name from autofill. */}
          <label htmlFor={nameId}>Project</label>
          <LineInput
            id={nameId}
            className="editor-title"
            value={name}
            autoFocus
            maxLength={100}
            onValueChange={setName}
          />
        </div>

        <fieldset className="field">
          <legend>Color</legend>
          <div className="swatches">
            {PROJECT_COLORS.map((c, i) => (
              <label key={c} className="swatch" style={{ background: c }}>
                <input
                  type="radio"
                  name="color"
                  value={c}
                  checked={color === c}
                  onChange={() => setColor(c)}
                  aria-label={COLOR_NAMES[i] ?? c}
                />
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="field">
          <legend>Icon</legend>
          <div className="icon-choices">
            <label className="icon-choice icon-auto" title="Picked from the name">
              <input type="radio" name="icon" checked={icon === null} onChange={() => setIcon(null)} />
              <span>{auto ?? '–'}</span>
              <span className="icon-auto-label">Auto</span>
            </label>
            {ICON_CHOICES.map((c) => (
              <label key={c} className="icon-choice">
                <input type="radio" name="icon" checked={icon === c} onChange={() => setIcon(c)} aria-label={c} />
                <span aria-hidden="true">{c}</span>
              </label>
            ))}
            <input
              className="icon-custom"
              autoComplete="off"
              aria-label="Another emoji"
              placeholder="Other"
              maxLength={16}
              value={customIcon}
              onChange={(e) => {
                const v = e.target.value.trim();
                setCustomIcon(v);
                setIcon(v || null);
              }}
            />
          </div>
          <p className="field-hint">
            {icon === null ? (auto ? 'Auto picks one from the name.' : 'Auto shows none for this name. Pick one, or paste any emoji into Other.') : 'Shown beside the name on the board.'}
          </p>
        </fieldset>

        {project && index !== -1 && projects.length > 1 && (
          <fieldset className="field">
            <legend>Place on the board</legend>
            <div className="button-row">
              <button type="button" className="btn" disabled={index === 0 || move.isPending} onClick={() => shift(-1)}>
                Move earlier
              </button>
              <button
                type="button"
                className="btn"
                disabled={index === projects.length - 1 || move.isPending}
                onClick={() => shift(1)}
              >
                Move later
              </button>
            </div>
            <p className="field-hint" aria-live="polite">
              {index + 1} of {projects.length} projects. The Inbox always comes first.
            </p>
          </fieldset>
        )}

        {project && (
          <fieldset className="field">
            <legend>Archive or delete</legend>
            <div className="button-row">
              {confirm !== 'delete' && (
                <button type="button" className="btn btn-danger" disabled={busy} onClick={doArchive}>
                  {confirm === 'archive' ? 'Confirm archive' : 'Archive'}
                </button>
              )}
              {confirm !== 'archive' && (
                <button type="button" className="btn btn-danger" disabled={busy} onClick={doDelete}>
                  {confirm === 'delete' ? 'Delete for good' : 'Delete'}
                </button>
              )}
              {confirm && (
                <button type="button" className="btn btn-quiet" onClick={() => setConfirm(null)}>
                  Keep it
                </button>
              )}
            </div>
            <p className={confirm === 'delete' ? 'field-hint field-warning' : 'field-hint'} aria-live="polite">
              {confirm === 'delete'
                ? `Deletes ${project.name}, its ${openTasks} open ${openTasks === 1 ? 'task' : 'tasks'} and its finished tasks in Done. This can’t be undone.`
                : 'Archive hides the project and its tasks from the board and keeps them. Delete removes them for good.'}
            </p>
          </fieldset>
        )}
        {error && (
          <p className="editor-error" role="alert">
            {error}
          </p>
        )}

        <footer className="editor-foot">
          <span className="spacer" />
          <button type="button" className="btn btn-quiet" onClick={close}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {project ? 'Save' : 'Create project'}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
