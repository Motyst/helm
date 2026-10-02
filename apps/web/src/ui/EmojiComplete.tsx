import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { closedAt, exactEmoji, searchEmoji, toEmojis, typingAt, type Emoji } from './emoji.ts';
import './emoji.css';

type Field = HTMLInputElement | HTMLTextAreaElement;

interface Open {
  field: Field;
  start: number;
  hits: Emoji[];
  /** Caret, in viewport pixels: x, the top of its line and the bottom. */
  caret: { x: number; top: number; bottom: number };
}

/** Loaded on first use, so it costs nothing until someone types `:sm`. */
let loading: Promise<Emoji[]> | null = null;
const loadEmojis = () =>
  (loading ??= import('emojilib').then((m) => toEmojis(m.default)).catch((e: unknown) => {
    loading = null; // offline: try again next time
    throw e;
  }));

/** Keys that move the caret without typing (typing is caught by `input`). */
const CARET_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'Home', 'End']);

function textField(el: EventTarget | null): Field | null {
  if (el instanceof HTMLTextAreaElement) return el.readOnly || el.disabled ? null : el;
  if (el instanceof HTMLInputElement && (el.type === 'text' || el.type === 'search')) {
    return el.readOnly || el.disabled ? null : el;
  }
  return null;
}

/**
 * Slack-style emoji on computers: type `:fi` in any text field and pick 🔥 from a list, or type a
 * whole `:fire:`. Phones have an emoji keyboard, so this stays off on touch screens.
 */
export function EmojiComplete() {
  const fine = useFinePointer();
  const [open, setOpen] = useState<Open | null>(null);
  const [active, setActive] = useState(0);
  const openRef = useRef(open);
  openRef.current = open;
  const activeRef = useRef(active);
  activeRef.current = active;
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!fine) return;
    let latest = 0;

    async function check(field: Field) {
      const caret = field.selectionStart ?? 0;
      const text = field.value;
      if (caret !== field.selectionEnd) return setOpen(null);
      const typing = typingAt(text, caret);
      const closed = typing ? null : closedAt(text, caret);
      if (!typing && !closed) return setOpen(null);

      const call = ++latest;
      let all: Emoji[];
      try {
        all = await loadEmojis();
      } catch {
        return;
      }
      // Something newer was typed while the list loaded.
      if (call !== latest || field.value !== text || document.activeElement !== field) return;

      if (closed) {
        const hit = exactEmoji(all, closed.name);
        if (hit) replace(field, closed.start, caret, hit.emoji);
        return setOpen(null);
      }
      const hits = searchEmoji(all, typing!.query);
      if (!hits.length) return setOpen(null);
      setActive(0);
      // Line the list up with the colon.
      setOpen({ field, start: typing!.start, hits, caret: caretPoint(field, typing!.start) });
    }

    const onInput = (e: Event) => {
      const field = textField(e.target);
      if (field && !(e as InputEvent).isComposing) void check(field);
    };
    const onCaretMove = (e: Event) => {
      const o = openRef.current;
      if (e instanceof KeyboardEvent && !CARET_KEYS.has(e.key)) return;
      if (o && e.target === o.field) void check(o.field);
    };
    const onKey = (e: KeyboardEvent) => {
      const o = openRef.current;
      if (!o || e.target !== o.field || e.isComposing) return;
      const n = o.hits.length;
      let handled = true;
      if (e.key === 'ArrowDown') setActive((i) => (i + 1) % n);
      else if (e.key === 'ArrowUp') setActive((i) => (i - 1 + n) % n);
      else if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') pick(o, o.hits[activeRef.current]!);
      else if (e.key === 'Escape') setOpen(null);
      else handled = false;
      if (handled) {
        // Ahead of the field's own keys: Enter mustn't submit, Escape mustn't close the dialog.
        e.preventDefault();
        e.stopPropagation();
      }
    };
    const onLeave = (e: Event) => {
      if (e.target === openRef.current?.field) setOpen(null);
    };
    // The page moved under the field: follow the caret. The list scrolling itself changes nothing.
    const follow = (e: Event) => {
      if (e.target instanceof Node && popRef.current?.contains(e.target)) return;
      setOpen((o) => o && { ...o, caret: caretPoint(o.field, o.start) });
    };

    document.addEventListener('input', onInput, true);
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('keyup', onCaretMove, true);
    document.addEventListener('mouseup', onCaretMove, true);
    document.addEventListener('focusout', onLeave, true);
    window.addEventListener('resize', follow);
    document.addEventListener('scroll', follow, true);
    return () => {
      latest++;
      document.removeEventListener('input', onInput, true);
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('keyup', onCaretMove, true);
      document.removeEventListener('mouseup', onCaretMove, true);
      document.removeEventListener('focusout', onLeave, true);
      window.removeEventListener('resize', follow);
      document.removeEventListener('scroll', follow, true);
      setOpen(null);
    };
  }, [fine]);

  function pick(o: Open, e: Emoji) {
    replace(o.field, o.start, o.field.selectionStart ?? o.start, e.emoji);
    setOpen(null);
  }

  // Show in the top layer, above an open dialog, and keep the list on screen.
  useLayoutEffect(() => {
    const pop = popRef.current;
    if (!open || !pop) return;
    if (!pop.matches(':popover-open')) pop.showPopover();
    const { width, height } = pop.getBoundingClientRect();
    const below = open.caret.bottom + 4;
    const top = below + height > innerHeight - 8 ? Math.max(8, open.caret.top - height - 4) : below;
    pop.style.left = `${Math.max(8, Math.min(open.caret.x - 8, innerWidth - width - 8))}px`;
    pop.style.top = `${top}px`;
  }, [open]);

  useEffect(() => {
    popRef.current?.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  if (!open) return null;
  // Inside a modal dialog everything outside it is inert, so the list lives in the dialog.
  const host = open.field.closest('dialog') ?? document.body;
  return createPortal(
    <div ref={popRef} popover="manual" className="emoji-pop" role="listbox" aria-label="Emoji">
      {open.hits.map((e, i) => (
        <div
          key={e.emoji}
          role="option"
          aria-selected={i === active}
          className={`emoji-option${i === active ? ' is-active' : ''}`}
          // Keep the focus (and the caret) in the field.
          onMouseDown={(ev) => ev.preventDefault()}
          onMouseEnter={() => setActive(i)}
          onClick={() => pick(open, e)}
        >
          <span className="emoji-glyph">{e.emoji}</span>
          <span className="emoji-name">{e.name.replace(/_/g, ' ')}</span>
        </div>
      ))}
    </div>,
    host,
  );
}

/** Swap text in a field the way typing would: React sees the change and Ctrl+Z undoes it. */
function replace(field: Field, start: number, end: number, text: string) {
  field.focus();
  field.setSelectionRange(start, end);
  if (!document.execCommand('insertText', false, text)) {
    field.setRangeText(text, start, end, 'end');
    field.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

const MIRRORED = [
  'box-sizing', 'width', 'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'font-family', 'font-size', 'font-style',
  'font-weight', 'font-stretch', 'font-variant', 'line-height', 'letter-spacing', 'word-spacing', 'text-indent',
  'text-transform', 'tab-size', 'word-break', 'overflow-wrap',
];

/** Where the caret sits on screen, measured with a hidden copy of the field's text. */
function caretPoint(field: Field, caret: number): Open['caret'] {
  const style = getComputedStyle(field);
  const mirror = document.createElement('div');
  for (const p of MIRRORED) mirror.style.setProperty(p, style.getPropertyValue(p));
  Object.assign(mirror.style, {
    position: 'fixed',
    top: '0',
    left: '-9999px',
    visibility: 'hidden',
    overflow: 'hidden',
    whiteSpace: field instanceof HTMLInputElement ? 'pre' : 'pre-wrap',
  });
  mirror.textContent = field.value.slice(0, caret);
  const marker = document.createElement('span');
  marker.textContent = '​';
  mirror.append(marker);
  document.body.append(mirror);
  const box = field.getBoundingClientRect();
  const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.3;
  const x = box.left + marker.offsetLeft - field.scrollLeft;
  const top = box.top + marker.offsetTop - field.scrollTop;
  mirror.remove();
  return { x: Math.min(x, box.right), top, bottom: top + lineHeight };
}

function useFinePointer(): boolean {
  const query = '(hover: hover) and (pointer: fine)';
  const [fine, setFine] = useState(() => typeof matchMedia === 'function' && matchMedia(query).matches);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const mq = matchMedia(query);
    const update = () => setFine(mq.matches);
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return fine;
}
