import React, { createContext, useCallback, useContext, useState } from 'react';
import { CheckCircle2, Info, X, XCircle } from 'lucide-react';

export type ToastVariant = 'success' | 'error' | 'info';

interface ToastItem {
  id: number;
  message: string;
  variant: ToastVariant;
}

interface ToastContextValue {
  showToast: (message: string, variant?: ToastVariant) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(
    (message: string, variant: ToastVariant = 'success') => {
      const id = Date.now() + Math.floor(Math.random() * 1000);
      setToasts((prev) => [...prev, { id, message, variant }]);
      window.setTimeout(() => {
        dismiss(id);
      }, 3200);
    },
    [dismiss]
  );

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div
        aria-live="polite"
        className="no-print fixed top-4 left-1/2 -translate-x-1/2 z-[60] flex flex-col items-center gap-2 pointer-events-none w-[92vw] max-w-md"
      >
        {toasts.map((toast) => {
          const styleMap: Record<ToastVariant, string> = {
            success: 'bg-emerald-600/95 text-white border-emerald-500/80 shadow-emerald-900/15',
            error: 'bg-rose-600/95 text-white border-rose-500/80 shadow-rose-900/15',
            info: 'bg-slate-900/95 text-white border-slate-700/80 shadow-slate-900/20',
          };
          const Icon =
            toast.variant === 'success'
              ? CheckCircle2
              : toast.variant === 'error'
              ? XCircle
              : Info;
          return (
            <div
              key={toast.id}
              role="status"
              className={`animate-toast pointer-events-auto backdrop-blur-md flex items-center gap-2.5 px-4 py-3 rounded-2xl border shadow-xl text-sm font-semibold w-full ${styleMap[toast.variant]}`}
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span className="flex-1">{toast.message}</span>
              <button
                type="button"
                onClick={() => dismiss(toast.id)}
                aria-label="閉じる"
                className="p-0.5 rounded hover:bg-white/20"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
};

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within ToastProvider');
  }
  return ctx;
}
