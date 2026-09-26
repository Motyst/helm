import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { PROJECT_COLORS, type Project } from '@helm/shared';
import { ApiError } from '../../lib/api.ts';
import { useArchiveProject, useCreateProject, useUpdateProject } from '../../lib/queries.ts';
import '../task-editor/editor.css';
import { ICON_CHOICES, autoIcon } from './project-icon.ts';

const COLOR_NAMES = ['Periwinkle', 'Jade', 'Amber', 'Coral', 'Lilac', 'Teal', 'Rose', 'Olive'];

/** Create a project (project = undefined) or rename / recolor / re-icon / archive one. */
export function ProjectDialog({ project, onClose }: { project?: Project; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const nameId = useId();
  const create = useCreateProject();
  const update = useUpdateProject();
  const archive = useArchiveProject();
  const [name, setName] = useState(project?.name ?? '');
  const [color, setColor] = useState<string>(project?.color ?? PROJECT_COLORS[0]);
  /** null = pick one from the name. */
  const [icon, setIcon] = useState<string | null>(project?.icon ?? null);
  const [customIcon, setCustomIcon] = useState(project?.icon && !ICON_CHOICES.includes(project.icon) ? project.icon : '');
  const auto = autoIcon(name);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = create.isPending || update.isPending || archive.isPending;

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
    if (!confirmArchive) return setConfirmArchive(true);
    try {
      await archive.mutateAsync(project.id);
      close();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Couldn’t archive the project.');
    }
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
          <label htmlFor={nameId}>Name</label>
          <input
            id={nameId}
            className="editor-title"
            autoComplete="off"
            value={name}
            autoFocus
            maxLength={100}
            onChange={(e) => setName(e.target.value)}
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

        {confirmArchive && (
          <p className="field-hint">
            Archiving hides the project and its tasks from the board. Nothing is deleted.
          </p>
        )}
        {error && (
          <p className="editor-error" role="alert">
            {error}
          </p>
        )}

        <footer className="editor-foot">
          {project && (
            <button type="button" className="btn btn-quiet btn-danger" disabled={busy} onClick={doArchive}>
              {confirmArchive ? 'Confirm archive' : 'Archive'}
            </button>
          )}
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
