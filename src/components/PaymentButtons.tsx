'use client';

import { CreditCard, Loader2, ShieldCheck, Wallet, Zap } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type ComponentType } from 'react';
import { apiFetch, errorMessage, type PayResponse } from '@/lib/client-api';
import { captureException, trackEvent } from '@/lib/logrocket';
import { cn } from '@/lib/utils';

type Provider = 'STRIPE' | 'PAYPAL' | 'DEMO';

interface ProviderOption {
  key: Provider;
  label: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
  className: string;
}

const options: ProviderOption[] = [
  {
    key: 'STRIPE',
    label: 'Stripe',
    description: 'Tarjeta de crédito o débito',
    icon: CreditCard,
    className: 'border-brand-500/40 bg-brand-50/70 hover:border-brand-500',
  },
  {
    key: 'PAYPAL',
    label: 'PayPal',
    description: 'Paga con tu cuenta PayPal',
    icon: Wallet,
    className: 'border-accent-500/40 bg-accent-50/70 hover:border-accent-500',
  },
  {
    key: 'DEMO',
    label: 'Demo',
    description: 'Prueba sin cobro real',
    icon: Zap,
    className: 'border-surface-border bg-white hover:border-surface-muted',
  },
];

export interface PaymentButtonsProps {
  orderId: string;
  disabled?: boolean;
  showDemo?: boolean;
  onSuccess?: () => void;
  className?: string;
}

export function PaymentButtons({
  orderId,
  disabled = false,
  showDemo = true,
  onSuccess,
  className,
}: PaymentButtonsProps) {
  const router = useRouter();
  const [pending, setPending] = useState<Provider | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function pay(provider: Provider) {
    if (disabled || pending) return;
    setPending(provider);
    setError(null);
    trackEvent('checkout_started', { order_id: orderId, provider });
    try {
      const response = await apiFetch<PayResponse>(
        `/api/client/orders/${encodeURIComponent(orderId)}/pay`,
        { method: 'POST', body: JSON.stringify({ provider }) },
      );
      const url = response.checkout_url ?? response.payment_url ?? response.url;
      if (url) {
        trackEvent('checkout_redirected', { order_id: orderId, provider, demo: provider === 'DEMO' });
        window.location.assign(url);
        return;
      }
      trackEvent('checkout_completed', { order_id: orderId, provider });
      if (onSuccess) onSuccess();
      else router.refresh();
    } catch (cause) {
      captureException(cause);
      trackEvent('checkout_failed', { order_id: orderId, provider });
      setError(errorMessage(cause, 'No se pudo iniciar el pago. Intenta de nuevo.'));
    } finally {
      setPending(null);
    }
  }

  return (
    <div className={cn('space-y-3', className)}>
      <div className="grid gap-2.5 sm:grid-cols-2">
        {options
          .filter((option) => option.key !== 'DEMO' || showDemo)
          .map((option) => {
            const Icon = option.icon;
            const isPending = pending === option.key;
            return (
              <button
                key={option.key}
                type="button"
                onClick={() => void pay(option.key)}
                disabled={disabled || pending !== null}
                className={cn(
                  'flex items-center gap-3 rounded-lg border p-3 text-left transition disabled:cursor-not-allowed disabled:opacity-60',
                  option.className,
                )}
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-white text-brand-600 shadow-sm">
                  {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-bold text-surface-ink">
                    {isPending ? 'Redirigiendo…' : `Pagar con ${option.label}`}
                  </span>
                  <span className="block truncate text-xs text-surface-muted">{option.description}</span>
                </span>
              </button>
            );
          })}
      </div>
      {error ? (
        <p className="rounded-md border border-danger-500/25 bg-danger-500/5 px-3 py-2 text-xs text-danger-600" role="alert">
          {error}
        </p>
      ) : null}
      <p className="flex items-center gap-1.5 text-[11px] text-surface-muted">
        <ShieldCheck className="h-3.5 w-3.5 text-success-600" aria-hidden="true" />
        El trabajo solo se envía a imprimir después de confirmar el pago.
      </p>
    </div>
  );
}
