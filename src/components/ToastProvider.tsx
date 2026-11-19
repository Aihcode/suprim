'use client';

import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { cn } from '@/lib/utils';

export type ToastVariant = 'success' | 'error' | 'warning' | 'info';

export interface ToastInput {
  title: string;
  description?: string;
  variant?: ToastVariant;
}

interface ToastItem extends ToastInput {
  id: number;
}

interface ToastContextValue {
  toast: (input: ToastInput) => void;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const variantStyles: Record<ToastVariant, string> = {
  success: 'border-l-success-500 text-success-600',
  error: 'border-l-danger-500 text-danger-600',
  warning: 'border-l-warning-500 text-warning-600',
  info: 'border-l-brand-500 text-brand-600',
};

const variantIcons: Record<ToastVariant, ReactNode> = {
  success: <CheckCircle2 className="h-5 w-5" aria-hidden="true" />,
  error: <XCircle className="h-5 w-5" aria-hidden="true" />,
  warning: <AlertTriangle className="h-5 w-5" aria-hidden="true" />,
  info: <Info className="h-5 w-5" aria-hidden="true" />,
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: number) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const toast = useCallback(
    (input: ToastInput) => {
      const id = Date.now() + Math.floor(Math.random() * 1000);
      setItems((current) => [...current.slice(-3), { ...input, id }]);
      if (typeof window !== 'undefined') {
        window.setTimeout(() => dismiss(id), 5500);
      }
    },
    [dismiss],
  );

  const value = useMemo<ToastContextValue>(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-3 bottom-3 z-[100] flex flex-col items-end gap-2 sm:inset-x-auto sm:right-5 sm:bottom-5 sm:w-96"
        role="region"
        aria-label="Notificaciones"
      >
        {items.map((item) => {
          const variant = item.variant ?? 'info';
          return (
            <div
              key={item.id}
              className={cn(
                'pointer-events-auto flex w-full items-start gap-3 rounded-lg border border-surface-border border-l-4 bg-white p-3.5 shadow-card',
                variantStyles[variant],
              )}
              role="status"
            >
              <span className="mt-0.5 shrink-0">{variantIcons[variant]}</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-surface-ink">{item.title}</p>
                {item.description ? (
                  <p className="mt-0.5 text-xs leading-relaxed text-surface-muted">{item.description}</p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => dismiss(item.id)}
                className="rounded p-0.5 text-surface-muted transition hover:bg-surface-mid hover:text-surface-ink"
                aria-label="Cerrar notificación"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast debe usarse dentro de <ToastProvider>');
  }
  return context;
}
