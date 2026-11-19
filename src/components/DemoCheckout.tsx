'use client';

import { AlertCircle, CheckCircle2, Loader2, ShieldCheck, Zap } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { apiFetch, errorMessage, readString } from '@/lib/client-api';

export interface DemoCheckoutProps {
  id: string;
}

export function DemoCheckout({ id }: DemoCheckoutProps) {
  const router = useRouter();
  const [status, setStatus] = useState<'confirming' | 'done' | 'error'>('confirming');
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function confirm() {
      try {
        const data = await apiFetch<unknown>('/api/payments/demo-confirm', {
          method: 'POST',
          body: JSON.stringify({ order_id: id }),
        });
        const record = data as { order?: { id?: string }; message?: string } | null;
        if (active) {
          setStatus('done');
          setMessage(readString(record?.message, 'Pago demo confirmado correctamente.'));
          window.setTimeout(() => router.replace(`/checkout/${encodeURIComponent(id)}`), 1200);
        }
      } catch (cause) {
        if (active) {
          setStatus('error');
          setMessage(errorMessage(cause, 'No se pudo confirmar el pago demo.'));
        }
      }
    }
    void confirm();
    return () => {
      active = false;
    };
  }, [id, router]);

  return (
    <div className="section flex min-h-[60vh] items-center justify-center py-12">
      <div className="card w-full max-w-md p-6 text-center">
        <span
          className={`mx-auto flex h-14 w-14 items-center justify-center rounded-full ${
            status === 'error'
              ? 'bg-danger-500/10 text-danger-600'
              : status === 'done'
                ? 'bg-success-500/10 text-success-600'
                : 'bg-brand-50 text-brand-600'
          }`}
        >
          {status === 'confirming' ? (
            <Loader2 className="h-7 w-7 animate-spin" aria-hidden="true" />
          ) : status === 'done' ? (
            <CheckCircle2 className="h-7 w-7" aria-hidden="true" />
          ) : (
            <AlertCircle className="h-7 w-7" aria-hidden="true" />
          )}
        </span>

        <h1 className="mt-4 text-xl font-extrabold text-surface-ink">
          {status === 'confirming'
            ? 'Confirmando pago demo…'
            : status === 'done'
              ? '¡Pago confirmado!'
              : 'No se pudo completar'}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-surface-muted">
          {message ??
            (status === 'confirming'
              ? 'Estamos registrando tu pago de prueba y enviando el trabajo a la cola de impresión.'
              : 'Por favor, intenta nuevamente.')}
        </p>

        {status === 'done' ? (
          <p className="mt-4 text-xs text-success-600">Redirigiendo al detalle de la orden…</p>
        ) : null}

        {status === 'error' ? (
          <div className="mt-5 flex flex-col gap-2">
            <Link href={`/checkout/${encodeURIComponent(id)}`} className="btn-primary">
              Volver al checkout
            </Link>
            <button
              type="button"
              onClick={() => router.refresh()}
              className="btn-secondary"
            >
              Reintentar
            </button>
          </div>
        ) : null}

        <p className="mt-5 flex items-center justify-center gap-1.5 text-[11px] text-surface-muted">
          {status === 'error' ? (
            <Zap className="h-3.5 w-3.5 text-warning-600" aria-hidden="true" />
          ) : (
            <ShieldCheck className="h-3.5 w-3.5 text-success-600" aria-hidden="true" />
          )}
          Modo demostración · sin cargos reales
        </p>
      </div>
    </div>
  );
}
