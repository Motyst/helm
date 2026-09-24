import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import type { ApplyResult, AssistantChange, Priority, Task } from '@helm/shared';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../lib/api.ts';
import { keys } from '../../lib/queries.ts';
import { useToast } from '../../ui/Toast.tsx';
import { currentArrangement, moveItem } from './assistant-model.ts';

export type AssistantTab = 'order' | 'chat';

export interface OrderRow {
  taskId: string;
  priority: Priority;
  reason: string | null;
}

export type OrderState =
  | { status: 'idle'; error?: string }
  | { status: 'loading' }
  | { status: 'ready'; summary: string; rows: OrderRow[]; applying?: boolean; error?: string };

export interface Proposal {
  summary: string;
  changes: AssistantChange[];
  /** Which changes the user kept ticked. */
  selected: boolean[];
  applying?: boolean;
  results?: ApplyResult['results'];
  error?: string;
}

export interface ChatMsg {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  proposal?: Proposal;
  streaming?: boolean;
  error?: string;
}

interface AssistantApi {
  isOpen: boolean;
  tab: AssistantTab;
  show: (tab?: AssistantTab) => void;
  hide: () => void;
  setTab: (tab: AssistantTab) => void;

  order: OrderState;
  suggestOrder: () => void;
  cancelOrder: () => void;
  discardOrder: () => void;
  setRowPriority: (index: number, priority: Priority) => void;
  moveRow: (index: number, dir: -1 | 1) => void;
  applyOrder: () => Promise<void>;

  chat: ChatMsg[];
  streaming: boolean;
  send: (text: string) => void;
  stop: () => void;
  newChat: () => void;
  toggleChange: (msgId: string, index: number) => void;
  applyProposal: (msgId: string) => Promise<void>;
}

const Ctx = createContext<AssistantApi | null>(null);

/** Earlier turns sent with each message; older ones are dropped to keep requests small. */
const HISTORY = 20;

let seq = 0;
const nextId = () => `m${++seq}`;

const message = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : 'Something went wrong.');

/**
 * Assistant state lives here, above the panel, so a suggestion or a chat survives closing and
 * reopening it (and keeps streaming while closed).
 */
export function AssistantProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [isOpen, setOpen] = useState(false);
  const [tab, setTab] = useState<AssistantTab>('order');
  const [order, setOrder] = useState<OrderState>({ status: 'idle' });
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const chatRef = useRef<ChatMsg[]>([]);
  chatRef.current = chat;
  const orderCtrl = useRef<AbortController | null>(null);
  const chatCtrl = useRef<AbortController | null>(null);

  const tasks = () => qc.getQueryData<Task[]>(keys.tasks) ?? [];

  const show = useCallback((t?: AssistantTab) => {
    if (t) setTab(t);
    setOpen(true);
  }, []);
  const hide = useCallback(() => setOpen(false), []);

  // ----- Suggested order -----

  const suggestOrder = useCallback(async () => {
    orderCtrl.current?.abort();
    const ctrl = new AbortController();
    orderCtrl.current = ctrl;
    setOrder({ status: 'loading' });
    try {
      const s = await api.prioritize(ctrl.signal);
      setOrder({ status: 'ready', summary: s.summary, rows: s.items });
    } catch (e) {
      if (!ctrl.signal.aborted) setOrder({ status: 'idle', error: message(e) });
    }
  }, []);

  const cancelOrder = useCallback(() => {
    orderCtrl.current?.abort();
    setOrder({ status: 'idle' });
  }, []);

  const editRows = (fn: (rows: OrderRow[]) => OrderRow[]) =>
    setOrder((o) => (o.status === 'ready' ? { ...o, rows: fn(o.rows), error: undefined } : o));

  const applyOrder = async () => {
    if (order.status !== 'ready') return;
    const live = new Set(tasks().filter((t) => t.status !== 'done' && !t.deletedAt).map((t) => t.id));
    const items = order.rows.filter((r) => live.has(r.taskId)).map((r) => ({ id: r.taskId, priority: r.priority }));
    if (!items.length) return setOrder({ status: 'idle' });
    const before = currentArrangement(tasks(), items.map((i) => i.id));
    setOrder({ ...order, applying: true });
    try {
      const { results } = await api.applyChanges([{ action: 'arrange', items }]);
      if (!results[0]?.ok) throw new Error(results[0]?.error ?? 'Couldn’t apply the order.');
      setOrder({ status: 'idle' });
      toast({
        message: 'Order applied.',
        action: {
          label: 'Undo',
          run: () =>
            void api.applyChanges([{ action: 'arrange', items: before }]).catch((e) => toast({ message: `Not undone: ${message(e)}` })),
        },
      });
    } catch (e) {
      setOrder({ ...order, applying: false, error: message(e) });
    }
  };

  // ----- Chat -----

  const patchMsg = (id: string, fn: (m: ChatMsg) => ChatMsg) => setChat((list) => list.map((m) => (m.id === id ? fn(m) : m)));

  const send = useCallback(async (text: string) => {
    const content = text.trim();
    if (!content || chatRef.current.some((m) => m.streaming)) return;
    const user: ChatMsg = { id: nextId(), role: 'user', text: content };
    const reply: ChatMsg = { id: nextId(), role: 'assistant', text: '', streaming: true };
    const history = [...chatRef.current, user]
      .map((m) => ({ role: m.role, content: m.text || (m.proposal ? `(Proposed: ${m.proposal.summary})` : '') }))
      .filter((m) => m.content)
      .slice(-HISTORY);
    setChat((list) => [...list, user, reply]);

    const ctrl = new AbortController();
    chatCtrl.current = ctrl;
    try {
      for await (const e of api.chat(history, ctrl.signal)) {
        if (e.type === 'text') patchMsg(reply.id, (m) => ({ ...m, text: m.text + e.delta }));
        else if (e.type === 'proposal') {
          patchMsg(reply.id, (m) => ({
            ...m,
            proposal: { summary: e.summary, changes: e.changes, selected: e.changes.map(() => true) },
          }));
        } else if (e.type === 'error') patchMsg(reply.id, (m) => ({ ...m, error: e.message }));
      }
    } catch (e) {
      if (!ctrl.signal.aborted) patchMsg(reply.id, (m) => ({ ...m, error: message(e) }));
    } finally {
      patchMsg(reply.id, (m) => ({ ...m, streaming: false }));
      if (chatCtrl.current === ctrl) chatCtrl.current = null;
    }
  }, []);

  const stop = useCallback(() => chatCtrl.current?.abort(), []);
  const newChat = useCallback(() => {
    chatCtrl.current?.abort();
    setChat([]);
  }, []);

  const toggleChange = (msgId: string, index: number) =>
    patchMsg(msgId, (m) =>
      m.proposal
        ? { ...m, proposal: { ...m.proposal, selected: m.proposal.selected.map((s, i) => (i === index ? !s : s)) } }
        : m,
    );

  const applyProposal = async (msgId: string) => {
    const p = chatRef.current.find((m) => m.id === msgId)?.proposal;
    if (!p) return;
    const changes = p.changes.filter((_, i) => p.selected[i]);
    if (!changes.length) return;
    const setP = (fn: (p: Proposal) => Proposal) => patchMsg(msgId, (m) => (m.proposal ? { ...m, proposal: fn(m.proposal) } : m));
    setP((x) => ({ ...x, applying: true, error: undefined }));
    try {
      const { results } = await api.applyChanges(changes);
      // Map results back onto all changes; unticked ones have none.
      let k = 0;
      const all = p.changes.map((_, i) => (p.selected[i] ? results[k++]! : { ok: false, error: 'Skipped' }));
      setP((x) => ({ ...x, applying: false, results: all }));
      const ok = results.filter((r) => r.ok).length;
      toast({ message: ok === results.length ? `Applied ${ok} change${ok === 1 ? '' : 's'}.` : `Applied ${ok} of ${results.length} changes.` });
    } catch (e) {
      setP((x) => ({ ...x, applying: false, error: message(e) }));
    }
  };

  const streaming = chat.some((m) => m.streaming);

  const value: AssistantApi = {
    isOpen,
    tab,
    show,
    hide,
    setTab,
    order,
    suggestOrder: () => void suggestOrder(),
    cancelOrder,
    discardOrder: () => setOrder({ status: 'idle' }),
    setRowPriority: (i, priority) => editRows((rows) => rows.map((r, j) => (j === i ? { ...r, priority } : r))),
    moveRow: (i, dir) => editRows((rows) => moveItem(rows, i, dir)),
    applyOrder,
    chat,
    streaming,
    send: (t) => void send(t),
    stop,
    newChat,
    toggleChange,
    applyProposal,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAssistant(): AssistantApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAssistant must be used inside AssistantProvider');
  return ctx;
}
