import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState, type FocusEvent, type FormEvent, type KeyboardEvent } from 'react';
import { parseQuickAdd, projectCandidates, type Priority, type Project, type Task } from '@helm/shared';
import { api } from '../../lib/api.ts';
import { upsertTask } from '../../lib/queries.ts';
import { useToast } from '../../ui/Toast.tsx';
import { LineInput } from '../../ui/LineInput.tsx';
import { useEditor } from '../task-editor/EditorContext.tsx';

const PRIORITY_LABEL: Record<Priority, string> = { now: 'Now', soon: 'Soon', someday: 'Someday' };
/** The pill's order: one tap from the default (Soon) gives Now, the likelier change. */
const CYCLE: Priority[] = ['soon', 'now', 'someday'];

// Buttons next to the field mustn't take focus from it: that would drop the phone keyboard.
const keepFocus = (e: { preventDefault: () => void }) => e.preventDefault();

interface QuickAddProps {
  /** null for the Inbox. */
  projectId: string | null;
  name: string;
  projects: Project[];
  /** A task was added here (so the panel keeps it in view under "Show more"). */
  onAdded: (task: Task) => void;
}

/**
 * "Add a task" row at the top of a panel: type a title, Enter adds it to this project and keeps
 * the field open for the next one. Shorthand works as in the full form (`!now`, `~15m`, `#project`).
 */
export function QuickAdd({ projectId, name, projects, onAdded }: QuickAddProps) {
  const qc = useQueryClient();
  const toast = useToast();
  const editor = useEditor();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [priority, setPriority] = useState<Priority>('soon');
  const [added, setAdded] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const hintId = useId();

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const close = () => {
    setOpen(false);
    setText('');
    setAdded(null);
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    const typed = text.trim();
    if (!typed) return close();
    const parsed = parseQuickAdd(typed);
    const hits = parsed.projectQuery ? projectCandidates(parsed.projectQuery, projects) : [];
    // A #name that isn't one project stays part of the title.
    const title = parsed.projectQuery && hits.length !== 1 ? `${parsed.title} #${parsed.projectQuery}`.trim() : parsed.title;
    if (!title) return;
    setText('');
    inputRef.current?.focus();
    try {
      const task = await api.createTask({
        title,
        projectId: hits.length === 1 ? hits[0]!.id : projectId,
        priority: parsed.priority ?? priority,
        estimateMinutes: parsed.estimateMinutes ?? undefined,
      });
      upsertTask(qc, task);
      onAdded(task);
      setAdded(task.projectId === projectId ? task.title : `${task.title} (to ${hits[0]?.name})`);
    } catch (err) {
      // Give the text back so nothing typed is lost.
      setText((now) => now || typed);
      toast({ message: `Couldn’t add “${title}”: ${(err as Error).message}` });
    }
  }

  function openFullForm() {
    const title = text.trim();
    close();
    editor.openCreate({ projectId, priority, title });
  }

  // Leaving an empty field closes it; a typed one stays so nothing is lost.
  function onBlur(e: FocusEvent<HTMLFormElement>) {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null) && !text.trim()) close();
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter on an empty field closes it (the disabled Add button blocks a normal submit).
    if (e.key === 'Escape' || (e.key === 'Enter' && !text.trim())) {
      e.preventDefault();
      close();
    }
  }

  if (!open) {
    return (
      <button type="button" className="quick-add-row" onClick={() => setOpen(true)}>
        <span className="quick-add-plus" aria-hidden="true">
          +
        </span>
        Add a task
      </button>
    );
  }

  return (
    <div className="quick-add">
      <form className="quick-add-form" onSubmit={submit} onBlur={onBlur}>
        {/* A textarea, not an input: Chrome on Android offers saved addresses and cards above the
            keyboard for text inputs, whatever autocomplete says (see LineInput). */}
        <LineInput
          ref={inputRef}
          className="quick-add-input"
          value={text}
          onValueChange={setText}
          onKeyDown={onKeyDown}
          placeholder={`Add to ${name}…`}
          aria-label={`New task in ${name}`}
          aria-describedby={hintId}
          // The return key, not "done": the field stays open for the next task.
          enterKeyHint="enter"
          maxLength={500}
        />
        <button
          type="button"
          className={`quick-add-prio quick-add-prio-${priority}`}
          aria-label={`Priority: ${PRIORITY_LABEL[priority]}. Change`}
          title="Change priority"
          onMouseDown={keepFocus}
          onClick={() => setPriority((p) => CYCLE[(CYCLE.indexOf(p) + 1) % CYCLE.length]!)}
        >
          {PRIORITY_LABEL[priority]}
        </button>
        <button
          type="button"
          className="quick-add-more"
          aria-label="Open the full form"
          title="Open the full form"
          onMouseDown={keepFocus}
          onClick={openFullForm}
        >
          ⋯
        </button>
        <button type="submit" className="quick-add-send" aria-label="Add task" disabled={!text.trim()} onMouseDown={keepFocus}>
          ↵
        </button>
      </form>
      <p className="quick-add-hint" id={hintId} aria-live="polite">
        {added ? `Added: ${added}` : 'Enter adds it and keeps the field open · ⋯ for details'}
      </p>
    </div>
  );
}
