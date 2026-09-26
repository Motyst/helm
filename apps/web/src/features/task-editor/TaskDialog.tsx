import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { PRIORITIES, matchProject, parseQuickAdd, type Priority, type Task } from '@helm/shared';
import { api, ApiError } from '../../lib/api.ts';
import { formatMinutes } from '../../lib/format.ts';
import { upsertTask, useCreateProject, useProjects, useTasks } from '../../lib/queries.ts';
import type { EditorTarget } from './EditorContext.tsx';
import { createFromDraft, draftFrom, draftFromSuggestion, saveDraft, type SubtaskDraft, type TaskDraft } from './save.ts';
import './editor.css';

const PRIORITY_LABEL: Record<Priority, string> = { now: 'Now', soon: 'Soon', someday: 'Someday' };
const ESTIMATES = [15, 30, 45, 60, 90, 120];
const NEW_PROJECT = '__new__';

let keySeq = 0;
const newSub = (): SubtaskDraft => ({ key: `new-${++keySeq}`, title: '', done: false });

interface Props {
  target: EditorTarget;
  /** Voice drafts waiting after this one. */
  queued: number;
  /** `next` = saved or skipped (show the next queued draft); otherwise close everything. */
  onClose: (next: boolean) => void;
}

export function TaskDialog({ target, queued, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();
  const tasks = useTasks();
  const projects = useProjects();
  const createProject = useCreateProject();
  const ids = { title: useId(), notes: useId(), project: useId(), estimate: useId() };

  const editing: Task | undefined =
    target.mode === 'edit' ? tasks.data?.find((t) => t.id === target.taskId && !t.deletedAt) : undefined;
  const originalSubs = useMemo(
    () => (editing ? (tasks.data ?? []).filter((t) => t.parentTaskId === editing.id && !t.deletedAt) : []),
    // Snapshot at open: later live updates shouldn't clobber what's being typed.
    [editing?.id],
  );
  const parentId = target.mode === 'create' ? target.defaults.parentTaskId : editing?.parentTaskId ?? undefined;
  const parent = parentId ? tasks.data?.find((t) => t.id === parentId) : undefined;
  const isSubtask = Boolean(parentId);
  const voice = target.mode === 'create' ? target.defaults.voice : undefined;

  const [draft, setDraft] = useState<TaskDraft>(() =>
    editing
      ? draftFrom(editing, originalSubs)
      : voice
        ? draftFromSuggestion(voice.suggestion)
        : {
            title: '',
            notes: '',
            projectId: target.mode === 'create' ? (target.defaults.projectId ?? null) : null,
            priority: target.mode === 'create' ? (target.defaults.priority ?? 'soon') : 'soon',
            estimateMinutes: null,
            subtasks: [],
          },
  );
  const [unmatchedProject, setUnmatchedProject] = useState<string | null>(voice?.suggestion.unmatchedProject ?? null);
  const [newProjectName, setNewProjectName] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Subtask row to focus after the next render (set when rows are added/removed by keyboard).
  const [focusSub, setFocusSub] = useState<string | null>(null);

  useLayoutEffect(() => {
    if (!focusSub) return;
    document.getElementById(`sub-${focusSub}`)?.focus();
    setFocusSub(null);
  }, [focusSub]);

  const set = <K extends keyof TaskDraft>(k: K, v: TaskDraft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const parsed = parseQuickAdd(draft.title);

  useEffect(() => {
    const d = dialogRef.current;
    if (d && !d.open) d.showModal();
    titleRef.current?.focus();
  }, []);

  // Tell the parent directly; the native `close` event (kept for Escape) can arrive late or not at
  // at all. Only once: a second call would skip a queued draft.
  const closed = useRef(false);
  const close = (next = false) => {
    if (closed.current) return;
    closed.current = true;
    dialogRef.current?.close();
    onClose(next);
  };

  // The task was deleted elsewhere while open.
  useEffect(() => {
    if (target.mode === 'edit' && tasks.data && !editing) close();
  });

  function onTitleChange(raw: string) {
    const q = parseQuickAdd(raw);
    setDraft((d) => {
      const next = { ...d, title: raw };
      if (q.priority) next.priority = q.priority;
      if (q.estimateMinutes) next.estimateMinutes = q.estimateMinutes;
      if (q.projectQuery && !isSubtask) {
        const match = matchProject(q.projectQuery, projects.data ?? []);
        if (match) next.projectId = match.id;
      }
      return next;
    });
    setUnmatchedProject(
      q.projectQuery && !isSubtask && !matchProject(q.projectQuery, projects.data ?? []) ? q.projectQuery : null,
    );
  }

  async function addProject(name: string) {
    const p = await createProject.mutateAsync({ name });
    set('projectId', p.id);
    setUnmatchedProject(null);
    setNewProjectName(null);
  }

  function updateSub(key: string, patch: Partial<SubtaskDraft>) {
    set(
      'subtasks',
      draft.subtasks.map((s) => (s.key === key ? { ...s, ...patch } : s)),
    );
  }

  function addSubAfter(key?: string) {
    const fresh = newSub();
    const i = key ? draft.subtasks.findIndex((s) => s.key === key) : -1;
    const subs = draft.subtasks.slice();
    subs.splice(i === -1 ? subs.length : i + 1, 0, fresh);
    set('subtasks', subs);
    setFocusSub(fresh.key);
  }

  function onSubKeyDown(e: KeyboardEvent<HTMLInputElement>, s: SubtaskDraft) {
    if (e.key === 'Enter') {
      e.preventDefault();
      addSubAfter(s.key);
    } else if (e.key === 'Backspace' && s.title === '') {
      e.preventDefault();
      const i = draft.subtasks.findIndex((x) => x.key === s.key);
      set(
        'subtasks',
        draft.subtasks.filter((x) => x.key !== s.key),
      );
      const prev = draft.subtasks[i - 1];
      if (prev) setFocusSub(prev.key);
    }
  }

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    const title = parsed.title.trim();
    if (!title) {
      setError('Give the task a title.');
      titleRef.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const final = { ...draft, title };
      if (editing) {
        await saveDraft(editing, originalSubs, final);
      } else {
        upsertTask(qc, await createFromDraft(final, parentId, voice ? 'voice' : undefined));
      }
      close(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Couldn’t save. Check that the server is running.');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!editing) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setBusy(true);
    try {
      upsertTask(qc, await api.deleteTask(editing.id));
      close();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Couldn’t delete.');
      setBusy(false);
    }
  }

  const heading = editing
    ? isSubtask
      ? 'Edit subtask'
      : 'Edit task'
    : isSubtask
      ? 'New subtask'
      : voice
        ? voice.total > 1
          ? `Task from voice, ${voice.index} of ${voice.total}`
          : 'Task from voice'
        : 'New task';
  const estimateIsCustom = draft.estimateMinutes !== null && !ESTIMATES.includes(draft.estimateMinutes);

  return (
    <dialog
      ref={dialogRef}
      className="editor"
      aria-labelledby="editor-heading"
      onClose={() => close()}
      onClick={(e) => {
        if (e.target === dialogRef.current) close(); // backdrop click
      }}
    >
      <form
        className="editor-form"
        // Not a form Chrome should fill: no password, card or address bar above the keyboard.
        autoComplete="off"
        onSubmit={submit}
        onKeyDown={(e) => {
          // Enter already submits from inputs; Ctrl/Cmd+Enter adds that for the notes textarea.
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && e.target instanceof HTMLTextAreaElement) {
            e.preventDefault();
            void submit();
          }
        }}
      >
        <header className="editor-head">
          <h2 id="editor-heading">{heading}</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={() => close()}>
            ✕
          </button>
        </header>

        {parent && <p className="editor-parent">Part of {parent.title}</p>}
        {voice && (
          <div className="editor-voice">
            <p>
              <span className="editor-voice-label">You said</span> <q>{voice.transcript}</q>
            </p>
            {voice.notice ? (
              <p className="editor-voice-note">{voice.notice}</p>
            ) : (
              !voice.parsed && (
                <p className="editor-voice-note">
                  What you said is the title. Add an OpenAI key to have Helm fill in the project, priority and
                  estimate.
                </p>
              )
            )}
          </div>
        )}

        <div className="field">
          <label htmlFor={ids.title} className="visually-hidden">
            Title
          </label>
          <input
            id={ids.title}
            ref={titleRef}
            className="editor-title"
            value={draft.title}
            onChange={(e) => onTitleChange(e.target.value)}
            placeholder="What needs doing?"
            autoComplete="off"
            maxLength={500}
          />
          {parsed.title !== draft.title.trim() && parsed.title && (
            <p className="field-hint">Saves as “{parsed.title}”</p>
          )}
          {!draft.title && !editing && !voice && (
            <p className="field-hint">Shorthand works here: #project, !now, ~30m</p>
          )}
          {unmatchedProject && (
            <p className="field-hint">
              No project matches “{unmatchedProject}”.{' '}
              <button type="button" className="link-btn" onClick={() => addProject(unmatchedProject)}>
                Create project “{unmatchedProject}”
              </button>
            </p>
          )}
        </div>

        <div className="editor-grid">
          {!isSubtask && (
            <div className="field">
              <label htmlFor={ids.project}>Project</label>
              {newProjectName === null ? (
                <select
                  id={ids.project}
                  value={draft.projectId ?? ''}
                  onChange={(e) => {
                    if (e.target.value === NEW_PROJECT) setNewProjectName('');
                    else set('projectId', e.target.value || null);
                  }}
                >
                  <option value="">Inbox</option>
                  {(projects.data ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                  <option value={NEW_PROJECT}>New project…</option>
                </select>
              ) : (
                <div className="inline-new">
                  <input
                    id={ids.project}
                    autoComplete="off"
                    autoFocus
                    placeholder="Project name"
                    value={newProjectName}
                    onChange={(e) => setNewProjectName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        if (newProjectName.trim()) void addProject(newProjectName.trim());
                      } else if (e.key === 'Escape') {
                        e.preventDefault();
                        setNewProjectName(null);
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="btn"
                    disabled={!newProjectName.trim() || createProject.isPending}
                    onClick={() => addProject(newProjectName.trim())}
                  >
                    Create
                  </button>
                  <button type="button" className="btn btn-quiet" onClick={() => setNewProjectName(null)}>
                    Cancel
                  </button>
                </div>
              )}
            </div>
          )}

          <fieldset className="field">
            <legend>Priority</legend>
            <div className="segmented">
              {PRIORITIES.map((p) => (
                <label key={p} className={`seg seg-${p}`}>
                  <input
                    type="radio"
                    name="priority"
                    value={p}
                    checked={draft.priority === p}
                    onChange={() => set('priority', p)}
                  />
                  <span>{PRIORITY_LABEL[p]}</span>
                </label>
              ))}
            </div>
          </fieldset>
        </div>

        <fieldset className="field">
          <legend>Estimate</legend>
          <div className="chips">
            <label className="chip">
              <input
                type="radio"
                name="estimate"
                checked={draft.estimateMinutes === null}
                onChange={() => set('estimateMinutes', null)}
              />
              <span>None</span>
            </label>
            {ESTIMATES.map((m) => (
              <label key={m} className="chip">
                <input
                  type="radio"
                  name="estimate"
                  checked={draft.estimateMinutes === m}
                  onChange={() => set('estimateMinutes', m)}
                />
                <span>{formatMinutes(m)}</span>
              </label>
            ))}
            <span className={`chip-input ${estimateIsCustom ? 'is-on' : ''}`}>
              <label htmlFor={ids.estimate} className="visually-hidden">
                Estimate in minutes
              </label>
              <input
                id={ids.estimate}
                autoComplete="off"
                type="number"
                inputMode="numeric"
                min={1}
                max={1440}
                placeholder="Other"
                value={estimateIsCustom ? String(draft.estimateMinutes) : ''}
                onChange={(e) => {
                  const n = Number.parseInt(e.target.value, 10);
                  set('estimateMinutes', Number.isFinite(n) && n > 0 ? Math.min(n, 1440) : null);
                }}
              />
              <span aria-hidden="true">min</span>
            </span>
          </div>
        </fieldset>

        {!isSubtask && (
          <fieldset className="field">
            <legend>Subtasks</legend>
            {draft.subtasks.length > 0 && (
              <ul className="sub-list">
                {draft.subtasks.map((s) => (
                  <li key={s.key} className="sub-row">
                    <input
                      type="checkbox"
                      checked={s.done}
                      aria-label={`Done: ${s.title || 'new subtask'}`}
                      onChange={(e) => updateSub(s.key, { done: e.target.checked })}
                    />
                    <input
                      id={`sub-${s.key}`}
                      autoComplete="off"
                      className={s.done ? 'is-done' : undefined}
                      value={s.title}
                      placeholder="Subtask"
                      aria-label="Subtask title"
                      maxLength={500}
                      onChange={(e) => updateSub(s.key, { title: e.target.value })}
                      onKeyDown={(e) => onSubKeyDown(e, s)}
                    />
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={`Remove ${s.title || 'subtask'}`}
                      onClick={() =>
                        set(
                          'subtasks',
                          draft.subtasks.filter((x) => x.key !== s.key),
                        )
                      }
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <button type="button" className="link-btn" onClick={() => addSubAfter()}>
              Add subtask
            </button>
          </fieldset>
        )}

        <div className="field">
          <label htmlFor={ids.notes}>Notes</label>
          <textarea
            id={ids.notes}
            autoComplete="off"
            rows={3}
            value={draft.notes}
            onChange={(e) => set('notes', e.target.value)}
            maxLength={20000}
          />
        </div>

        {error && (
          <p className="editor-error" role="alert">
            {error}
          </p>
        )}

        <footer className="editor-foot">
          {editing && (
            <button type="button" className="btn btn-quiet btn-danger" disabled={busy} onClick={remove}>
              {confirmDelete ? 'Confirm delete' : 'Delete'}
            </button>
          )}
          <span className="spacer" />
          <button type="button" className="btn btn-quiet" onClick={() => close(true)}>
            {queued ? 'Skip' : 'Cancel'}
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {editing ? 'Save' : isSubtask ? 'Add subtask' : 'Add task'}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
