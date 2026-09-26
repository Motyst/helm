import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { PRIORITIES, type Task } from '@helm/shared';
import { useAllProjects, useAssistantStatus, useTasks } from '../../lib/queries.ts';
import { ProjectLabel } from '../../ui/ProjectLabel.tsx';
import { describeChange, PRIORITY_LABEL } from './assistant-model.ts';
import { useAssistant, type ChatMsg } from './AssistantContext.tsx';
import './assistant.css';

/** Compass star: the assistant helps set a course. */
export function AssistantIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path
        d="M12 2.5 L14 10 L21.5 12 L14 14 L12 21.5 L10 14 L2.5 12 L10 10 Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" />
    </svg>
  );
}

export function AssistantPanel() {
  const a = useAssistant();
  const status = useAssistantStatus();
  const panelRef = useRef<HTMLElement>(null);
  const returnTo = useRef<Element | null>(null);
  const ids = { heading: useId(), order: useId(), chat: useId() };

  // Focus the panel on open; give focus back to where it came from on close.
  useEffect(() => {
    if (!a.isOpen) return;
    returnTo.current = document.activeElement;
    panelRef.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus();
    return () => {
      if (returnTo.current instanceof HTMLElement) returnTo.current.focus();
    };
  }, [a.isOpen]);

  if (!a.isOpen) return null;

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && !document.querySelector('dialog[open]')) {
      e.stopPropagation();
      a.hide();
    }
  };

  return (
    <aside ref={panelRef} className="assistant" aria-labelledby={ids.heading} onKeyDown={onKeyDown}>
      <header className="assistant-head">
        <h2 id={ids.heading} className="assistant-title">
          Assistant
        </h2>
        <div className="assistant-tabs" role="tablist" aria-label="Assistant tools">
          {(['order', 'chat'] as const).map((t) => (
            <button
              key={t}
              role="tab"
              id={`${ids[t]}-tab`}
              aria-selected={a.tab === t}
              aria-controls={ids[t]}
              tabIndex={a.tab === t ? 0 : -1}
              className="assistant-tab"
              onClick={() => a.setTab(t)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                  const other = t === 'order' ? 'chat' : 'order';
                  a.setTab(other);
                  document.getElementById(`${ids[other]}-tab`)?.focus();
                }
              }}
            >
              {t === 'order' ? 'Suggest order' : 'Chat'}
            </button>
          ))}
        </div>
        {a.tab === 'chat' && a.chat.length > 0 && !a.streaming && (
          <button type="button" className="link-btn assistant-new" onClick={a.newChat}>
            New chat
          </button>
        )}
        <button type="button" className="icon-btn" aria-label="Close assistant" onClick={a.hide}>
          ✕
        </button>
      </header>

      <div id={ids[a.tab]} role="tabpanel" aria-labelledby={`${ids[a.tab]}-tab`} className="assistant-body">
        {status.data && !status.data.available ? (
          <div className="assistant-intro">
            <p>{status.data.reason ?? 'The assistant is off.'}</p>
          </div>
        ) : a.tab === 'order' ? (
          <OrderTab />
        ) : (
          <ChatTab />
        )}
      </div>
    </aside>
  );
}

// ---------- Suggested order ----------

function OrderTab() {
  const a = useAssistant();
  const tasks = useTasks().data ?? [];
  const allProjects = useAllProjects().data ?? [];
  const projectMap = useMemo(() => new Map(allProjects.map((p) => [p.id, p])), [allProjects]);
  const byId = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const o = a.order;

  if (o.status === 'idle') {
    return (
      <div className="assistant-intro">
        <p>
          Get a suggested order for your open tasks, with a one-line reason for each. Change anything you disagree with,
          then apply it. Nothing changes until you do.
        </p>
        <p className="assistant-fine">Your open tasks and recent done work are sent to the AI model.</p>
        {o.error && (
          <p className="assistant-error" role="alert">
            {o.error}
          </p>
        )}
        <button type="button" className="btn btn-primary" onClick={a.suggestOrder}>
          {o.error ? 'Try again' : 'Suggest an order'}
        </button>
      </div>
    );
  }

  if (o.status === 'loading') {
    return (
      <div className="assistant-intro" aria-busy="true">
        <p className="assistant-working" role="status">
          Working out an order…
        </p>
        <button type="button" className="btn btn-quiet" onClick={a.cancelOrder}>
          Cancel
        </button>
      </div>
    );
  }

  // Tasks finished or deleted since the suggestion drop out.
  const rows = o.rows
    .map((r, index) => ({ ...r, index, task: byId.get(r.taskId) }))
    .filter((r): r is typeof r & { task: Task } => !!r.task && r.task.status !== 'done' && !r.task.deletedAt);

  return (
    <div className="order">
      <p className="order-summary">{o.summary}</p>
      <ol className="order-list">
        {rows.map((r, n) => (
          <li key={r.taskId} className="order-row">
            <span className="order-num" aria-hidden>
              {n + 1}
            </span>
            <div className="order-main">
              <p className="order-title">{r.task.title}</p>
              <p className="order-meta">
                <ProjectLabel projectId={r.task.projectId} projects={projectMap} />
                {r.task.status === 'in_progress' && <span className="order-flag">In progress</span>}
              </p>
              {r.reason && <p className="order-reason">{r.reason}</p>}
              <div className="order-prio" role="radiogroup" aria-label={`Priority for ${r.task.title}`}>
                {PRIORITIES.map((p) => (
                  <label key={p} className={`seg seg-${p}`}>
                    <input
                      type="radio"
                      name={`prio-${r.taskId}`}
                      checked={r.priority === p}
                      onChange={() => a.setRowPriority(r.index, p)}
                    />
                    <span>{PRIORITY_LABEL[p]}</span>
                  </label>
                ))}
                {r.priority !== r.task.priority && (
                  <span className="order-was">was {PRIORITY_LABEL[r.task.priority]}</span>
                )}
              </div>
            </div>
            <div className="order-move">
              <button
                type="button"
                className="icon-btn"
                aria-label={`Move ${r.task.title} up`}
                disabled={n === 0}
                onClick={() => a.moveRow(r.index, -1)}
              >
                ↑
              </button>
              <button
                type="button"
                className="icon-btn"
                aria-label={`Move ${r.task.title} down`}
                disabled={n === rows.length - 1}
                onClick={() => a.moveRow(r.index, 1)}
              >
                ↓
              </button>
            </div>
          </li>
        ))}
      </ol>
      <footer className="assistant-foot">
        {o.error && (
          <p className="assistant-error" role="alert">
            {o.error}
          </p>
        )}
        <button type="button" className="btn btn-quiet" onClick={a.discardOrder} disabled={o.applying}>
          Discard
        </button>
        <button type="button" className="btn btn-primary" onClick={() => void a.applyOrder()} disabled={o.applying || !rows.length}>
          {o.applying ? 'Applying…' : 'Apply this order'}
        </button>
      </footer>
    </div>
  );
}

// ---------- Chat ----------

const STARTERS = [
  'What should I work on next?',
  'Plan the rest of my day',
  'Break my current task into steps',
  'What did I get done this week?',
];

function ChatTab() {
  const a = useAssistant();
  const [draft, setDraft] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const inputId = useId();
  const last = a.chat.at(-1);

  // Follow the answer as it streams in, unless the user scrolled up to read.
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [last?.text, last?.proposal, a.chat.length]);

  const submit = (text = draft) => {
    if (!text.trim() || a.streaming) return;
    a.send(text);
    setDraft('');
    inputRef.current?.focus();
  };

  return (
    <div className="chat">
      <div ref={listRef} className="chat-list" aria-live="polite">
        {a.chat.length === 0 ? (
          <div className="assistant-intro">
            <p>Ask about your board, or ask for changes. You review every change before it happens.</p>
            <div className="chat-starters">
              {STARTERS.map((s) => (
                <button key={s} type="button" className="chat-starter" onClick={() => submit(s)}>
                  {s}
                </button>
              ))}
            </div>
            <p className="assistant-fine">Your open tasks and recent done work are sent to the AI model with each message.</p>
          </div>
        ) : (
          a.chat.map((m) => <Message key={m.id} m={m} />)
        )}
      </div>

      <form
        className="chat-compose"
        autoComplete="off"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label htmlFor={inputId} className="visually-hidden">
          Message the assistant
        </label>
        <textarea
          id={inputId}
          autoComplete="off"
          ref={inputRef}
          rows={1}
          value={draft}
          placeholder="Ask about your tasks"
          maxLength={8000}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
        />
        {a.streaming ? (
          <button type="button" className="btn" onClick={a.stop}>
            Stop
          </button>
        ) : (
          <button type="submit" className="btn btn-primary" disabled={!draft.trim()}>
            Send
          </button>
        )}
      </form>
    </div>
  );
}

function Message({ m }: { m: ChatMsg }) {
  const a = useAssistant();
  const tasks = useTasks().data ?? [];
  const projects = useAllProjects().data ?? [];

  if (m.role === 'user') return <p className="msg msg-user">{m.text}</p>;

  const p = m.proposal;
  return (
    <div className="msg msg-assistant" aria-busy={m.streaming}>
      {m.text ? <p className="msg-text">{m.text}</p> : m.streaming && !p && <p className="assistant-working">Thinking…</p>}
      {p && (
        <div className="proposal">
          <p className="proposal-title">{p.results ? 'Applied' : 'Proposed changes'}</p>
          <ul className="proposal-list">
            {p.changes.map((c, i) => {
              const r = p.results?.[i];
              return (
                <li key={i} className={r ? (r.ok ? 'is-ok' : 'is-failed') : undefined}>
                  {p.results ? (
                    <span className="proposal-mark" aria-hidden>
                      {r?.ok ? '✓' : '–'}
                    </span>
                  ) : (
                    <input
                      type="checkbox"
                      checked={p.selected[i]}
                      aria-label={`Include: ${describeChange(c, tasks, projects)}`}
                      onChange={() => a.toggleChange(m.id, i)}
                    />
                  )}
                  <span>
                    {describeChange(c, tasks, projects)}
                    {r && !r.ok && r.error !== 'Skipped' && <span className="proposal-err"> Not applied: {r.error}</span>}
                  </span>
                </li>
              );
            })}
          </ul>
          {p.error && (
            <p className="assistant-error" role="alert">
              {p.error}
            </p>
          )}
          {!p.results && (
            <button
              type="button"
              className="btn btn-primary"
              disabled={p.applying || !p.selected.some(Boolean)}
              onClick={() => void a.applyProposal(m.id)}
            >
              {p.applying ? 'Applying…' : `Apply ${p.selected.filter(Boolean).length === 1 ? 'change' : 'changes'}`}
            </button>
          )}
        </div>
      )}
      {m.error && (
        <p className="assistant-error" role="alert">
          {m.error}
        </p>
      )}
    </div>
  );
}
