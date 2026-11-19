'use client';

import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Copy,
  FileText,
  Loader2,
  Plus,
  Printer,
  RefreshCw,
  Repeat2,
  UploadCloud,
} from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Modal } from '@/components/Modal';
import { OrderTimeline } from '@/components/OrderTimeline';
import { PaymentButtons } from '@/components/PaymentButtons';
import { StatusBadge } from '@/components/StatusBadge';
import { useOrderProgress } from '@/components/useOrderProgress';
import { useToast } from '@/components/ToastProvider';
import { asArray, readNumber, readString, type Payment } from '@/lib/client-api';
import { cn, formatCurrency, formatDateTime, shortId } from '@/lib/utils';

export interface CheckoutViewProps {
  id: string;
}

export function CheckoutView({ id }: CheckoutViewProps) {
  const { order, progress, history, live, loading, error, refresh } = useOrderProgress(id);
  const { toast } = useToast();
  const [noticeOpen, setNoticeOpen] = useState(false);

  const status = (order?.status ?? progress?.status ?? 'PENDING').toUpperCase();
  const paid = ['PAID', 'PROCESSING', 'COMPLETED'].includes(status);
  const copies = Math.max(1, readNumber(order?.copies, 1));
  const pages = Math.max(1, readNumber(order?.pages, 1));
  const payments = asArray<Payment>(order?.payments);
  const transactionId =
    readString(order?.payment_id) ||
    readString(payments[0]?.provider_id) ||
    readString(payments[0]?.id) ||
    'Pendiente de pago';

  const repeatQuery = new URLSearchParams({
    copies: String(copies),
    pages: String(pages),
    color: String(Boolean(order?.color)),
    duplex: String(Boolean(order?.duplex)),
    paper: readString(order?.paper_size, 'A4'),
  }).toString();

  const addCopiesQuery = new URLSearchParams({
    copies: String(copies + 1),
    pages: String(pages),
    color: String(Boolean(order?.color)),
    duplex: String(Boolean(order?.duplex)),
    paper: readString(order?.paper_size, 'A4'),
  }).toString();

  async function copyId() {
    try {
      await navigator.clipboard.writeText(id);
      toast({ title: 'ID copiado', description: 'Ya puedes compartir el número de orden.', variant: 'success' });
    } catch {
      toast({ title: 'No se pudo copiar', description: 'Selecciona el ID manualmente.', variant: 'warning' });
    }
  }

  return (
    <div className="section space-y-5 py-8 sm:py-10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-widest text-brand-600">Checkout</p>
          <h1 className="mt-1 text-2xl font-black tracking-tight text-surface-ink sm:text-3xl">
            Tu orden de impresión
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StatusBadge status={status} size="md" />
            <button
              type="button"
              onClick={() => void copyId()}
              className="inline-flex items-center gap-1.5 rounded-md bg-white px-2 py-1 text-xs font-medium text-surface-muted ring-1 ring-inset ring-surface-border transition hover:text-brand-600"
              title="Copiar ID de orden"
            >
              <span className="font-mono">{shortId(id, 16)}</span>
              <Copy className="h-3 w-3" aria-hidden="true" />
            </button>
            <span className="inline-flex items-center gap-1.5 text-xs text-surface-muted">
              <span className={cn('h-1.5 w-1.5 rounded-full', live ? 'animate-pulse-dot bg-success-500' : 'bg-surface-muted')} />
              {live ? 'Actualización en vivo activa' : 'Modo actualización periódica'}
            </span>
          </div>
        </div>
        <Link href={`/track/${encodeURIComponent(id)}`} className="btn-secondary">
          Ver seguimiento público <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </div>

      {error ? (
        <div className="flex items-start gap-2 rounded-lg border border-warning-500/25 bg-warning-500/5 px-3 py-2.5 text-xs text-warning-600">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
        <section className="card p-5">
          <div className="flex items-center justify-between gap-3 border-b border-surface-border pb-3">
            <h2 className="text-sm font-bold text-surface-ink">Resumen de la orden</h2>
            {loading ? <Loader2 className="h-4 w-4 animate-spin text-brand-600" aria-hidden="true" /> : null}
          </div>

          <dl className="mt-4 space-y-2.5 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-surface-muted">Archivo</dt>
              <dd className="flex max-w-[60%] items-center gap-1.5 truncate font-medium text-surface-ink">
                <FileText className="h-3.5 w-3.5 shrink-0 text-surface-muted" aria-hidden="true" />
                {readString(order?.file_name, 'Documento')}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-surface-muted">Páginas / copias</dt>
              <dd className="font-medium tabular-nums text-surface-ink">{pages} / {copies}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-surface-muted">Modo</dt>
              <dd className="font-medium text-surface-ink">
                {order?.color ? 'A color' : 'Blanco y negro'} · {order?.duplex ? 'Dúplex' : 'Una cara'} ·{' '}
                {readString(order?.paper_size, 'A4')}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-surface-muted">Descuento</dt>
              <dd className="font-medium tabular-nums text-success-600">−{formatCurrency(readNumber(order?.discount, 0))}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-surface-muted">Páginas gratis aplicadas</dt>
              <dd className="font-medium tabular-nums text-accent-600">{readNumber(order?.free_pages, 0)}</dd>
            </div>
            <div className="flex justify-between gap-3 border-t border-surface-border pt-3">
              <dt className="font-bold text-surface-ink">Total pagado</dt>
              <dd className="text-xl font-extrabold tabular-nums text-brand-600">
                {formatCurrency(readNumber(order?.total_price, 0))}
              </dd>
            </div>
          </dl>

          <div className="mt-4 rounded-lg border border-surface-border bg-surface-light p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-surface-muted">ID de transacción</p>
            <p className="mt-1 break-all font-mono text-xs text-surface-ink">{transactionId}</p>
            <p className="mt-1 text-[11px] text-surface-muted">
              Proveedor: {readString(order?.payment_provider, 'Por seleccionar') || 'Por seleccionar'} · Creada:{' '}
              {formatDateTime(order?.created_at)}
            </p>
          </div>

          {!paid ? (
            <div className="mt-5 border-t border-surface-border pt-4">
              <h3 className="text-sm font-bold text-surface-ink">Elige cómo pagar</h3>
              <p className="mb-3 mt-1 text-xs text-surface-muted">
                Se habilitarán los métodos configurados por la imprenta. El modo DEMO está disponible
                para probar el flujo sin cobros reales.
              </p>
              <PaymentButtons orderId={id} />
            </div>
          ) : (
            <p className="mt-5 flex items-center gap-2 rounded-lg border border-success-500/25 bg-success-500/5 p-3 text-sm font-medium text-success-600">
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Pago confirmado. Tu trabajo está en la cola de impresión.
            </p>
          )}
        </section>

        <section className="card p-5">
          <div className="flex items-center justify-between gap-3 border-b border-surface-border pb-3">
            <h2 className="text-sm font-bold text-surface-ink">Progreso en vivo</h2>
            <button
              type="button"
              onClick={() => void refresh()}
              className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Actualizar
            </button>
          </div>
          <div className="mt-4">
            <OrderTimeline
              progress={progress}
              history={history}
              orderStatus={status}
            />
          </div>
        </section>
      </div>

      <section className="card overflow-hidden">
        <div className="border-b border-surface-border bg-gradient-to-r from-accent-50 to-white px-5 py-4">
          <div className="flex items-center gap-2">
            <Printer className="h-5 w-5 text-accent-600" aria-hidden="true" />
            <h2 className="text-base font-bold text-surface-ink">Seguir imprimiendo</h2>
          </div>
          <p className="mt-1 text-xs text-surface-muted">
            ¿Necesitas más impresiones? Continúa en la misma sesión sin perder tus preferencias.
          </p>
        </div>
        <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <Link href="/quote" className="group flex items-start gap-3 rounded-lg border border-surface-border p-4 transition hover:border-brand-500 hover:bg-brand-50/50">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
              <UploadCloud className="h-4 w-4" aria-hidden="true" />
            </span>
            <span>
              <span className="block text-sm font-bold text-surface-ink">Subir nuevos archivos</span>
              <span className="mt-0.5 block text-xs text-surface-muted">Cotiza otro documento ahora.</span>
            </span>
          </Link>
          <Link href={`/quote?${repeatQuery}`} className="group flex items-start gap-3 rounded-lg border border-surface-border p-4 transition hover:border-brand-500 hover:bg-brand-50/50">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-50 text-accent-600">
              <Repeat2 className="h-4 w-4" aria-hidden="true" />
            </span>
            <span>
              <span className="block text-sm font-bold text-surface-ink">Repetir esta orden</span>
              <span className="mt-0.5 block text-xs text-surface-muted">Mismo documento y ajustes.</span>
            </span>
          </Link>
          <Link href={`/quote?${addCopiesQuery}`} className="group flex items-start gap-3 rounded-lg border border-surface-border p-4 transition hover:border-brand-500 hover:bg-brand-50/50">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-success-500/10 text-success-600">
              <Plus className="h-4 w-4" aria-hidden="true" />
            </span>
            <span>
              <span className="block text-sm font-bold text-surface-ink">Agregar copias</span>
              <span className="mt-0.5 block text-xs text-surface-muted">Añade {copies + 1} copias a tu pedido.</span>
            </span>
          </Link>
          <button
            type="button"
            onClick={() => setNoticeOpen(true)}
            className="group flex items-start gap-3 rounded-lg border border-surface-border p-4 text-left transition hover:border-brand-500 hover:bg-brand-50/50"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-warning-500/10 text-warning-600">
              <Printer className="h-4 w-4" aria-hidden="true" />
            </span>
            <span>
              <span className="block text-sm font-bold text-surface-ink">Enviar a otra impresora</span>
              <span className="mt-0.5 block text-xs text-surface-muted">Solicita el cambio al operador.</span>
            </span>
          </button>
        </div>
      </section>

      <Modal
        open={noticeOpen}
        onOpenChange={setNoticeOpen}
        title="Cambiar de impresora"
        description="La reasignación de impresoras la realiza el personal autorizado."
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setNoticeOpen(false)}>
              Entendido
            </button>
            <Link href={`/track/${encodeURIComponent(id)}`} className="btn-primary" onClick={() => setNoticeOpen(false)}>
              Ver seguimiento
            </Link>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-surface-muted">
          Muestra este ID de orden (<span className="font-mono font-semibold text-surface-ink">{shortId(id, 16)}</span>)
          en el mostrador. El equipo puede reasignar la impresora desde el panel de empleados sin
          perder tu pago ni tu lugar en la cola.
        </p>
      </Modal>
    </div>
  );
}
