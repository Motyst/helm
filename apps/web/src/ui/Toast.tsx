import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import './toast.css';

interface ToastInput {
  message: string;
  action?: { label: string; run: () => void };
}

const ToastCtx = createContext<((t: ToastInput) => void) | null>(null);

const DURATION_MS = 6000;

/** One toast at a time; a new one replaces the old. Used for "Marked done. Undo". */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<(ToastInput & { id: number }) | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const show = useCallback((t: ToastInput) => {
    setToast({ ...t, id: Date.now() });
  }, []);

  useEffect(() => {
    if (!toast) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), DURATION_MS);
    return () => clearTimeout(timer.current);
  }, [toast]);

  return (
    <ToastCtx.Provider value={show}>
      {children}
      <div className="toast-region" role="status" aria-live="polite">
        {toast && (
          <div className="toast" key={toast.id}>
            <span>{toast.message}</span>
            {toast.action && (
              <button
                className="toast-action"
                onClick={() => {
                  toast.action!.run();
                  setToast(null);
                }}
              >
                {toast.action.label}
              </button>
            )}
          </div>
        )}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}
