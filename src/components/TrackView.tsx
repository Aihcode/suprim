'use client';

import { AlertCircle, FileSearch, Loader2, Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { OrderTimeline } from '@/components/OrderTimeline';
import { StatusBadge } from '@/components/StatusBadge';
import { useOrderProgress } from '@/components/useOrderProgress';
import { readNumber, readString } from '@/lib/client-api';
import { cn, formatDateTime, shortId } from '@/lib/utils';

export interface TrackViewProps {
  id: string;
}

export function TrackView({ id }: TrackViewProps) {
  const router = useRouter();
  const { order, progress, history, live, loading, error } = useOrderProgress(id);
  const [query, setQuery] = useState('');

  const status = (order?.status ?? progress?.status ?? 'PENDING').toUpperCase();
  const paid = ['PAID', 'PROCESSING', 'COMPLETED'].includes(status);
  const currentPage = Math.max(0, readNumber(progress?.page_current, 0));
  const totalPages = Math.max(0, readNumber(progress?.page_total, 0));

  function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = query.trim();
    if (value) router.push(`/track/${encodeURIComponent(value)}`);
  }

  return (
    <div className="section space-y-5 py-8 sm:py-10">
      <div className="rounded-xl bg-gradient-to-r from-brand-700 to-accent-600 px-5 py-6 text-white sm:px-8">
        <p className="text-[11px] font-bold uppercase tracking-widest text-accent-100">Seguimiento público</p>
        <h1 className="mt-1 text-2xl font-black sm:text-3xl">Rastrea tu impresión</h1>
        <p className="mt-2 break-all text-sm text-blue-50/90">
          Orden <span className="font-mono font-semibold">{id}</span>
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <StatusBadge status={status} size="md" className="bg-white/15 text-white ring-white/25" />
          <span className="inline-flex items-center gap-1.5 text-xs text-blue-50/90">
            <span className={cn('h-1.5 w-1.5 rounded-full', live ? 'animate-pulse-dot bg-accent-100' : 'bg-white/50')} />
            {live ? 'Conectado en tiempo real' : 'Actualizando periódicamente'}
          </span>
        </div>
      </div>

      {error ? (
        <div className="flex items-start gap-2 rounded-lg border border-warning-500/25 bg-warning-500/5 px-3 py-2.5 text-xs text-warning-600">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
        <section className="card p-5">
          <div className="flex items-center justify-between gap-3 border-b border-surface-border pb-3">
            <h2 className="text-sm font-bold text-surface-ink">Estado de la impresión</h2>
            {loading ? <Loader2 className="h-4 w-4 animate-spin text-brand-600" aria-hidden="true" /> : null}
          </div>
          <div className="mt-4">
            <OrderTimeline progress={progress} history={history} orderStatus={status} />
          </div>
          {totalPages > 0 ? (
            <p className="mt-3 rounded-lg bg-brand-50 px-3 py-2 text-xs font-medium text-brand-600">
              Avance actual: {currentPage} de {totalPages} páginas
            </p>
          ) : null}
        </section>

        <div className="space-y-5">
          <section className="card p-5">
            <h2 className="text-sm font-bold text-surface-ink">Estado del pago</h2>
            <div className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between gap-3">
                <span className="text-surface-muted">Resultado</span>
                <span className={paid ? 'font-semibold text-success-600' : 'font-semibold text-warning-600'}>
                  {paid ? 'Pagado' : status === 'FAILED' || status === 'CANCELLED' ? 'No completado' : 'Pendiente'}
                </span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-surface-muted">Proveedor</span>
                <span className="font-medium text-surface-ink">{readString(order?.payment_provider, '—') || '—'}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-surface-muted">Transacción</span>
                <span className="max-w-[60%] break-all text-right font-mono text-xs text-surface-ink">
                  {readString(order?.payment_id, '—') || '—'}
                </span>
              </div>
            </div>
            {!order ? (
              <p className="mt-3 text-[11px] leading-relaxed text-surface-muted">
                El detalle completo puede requerir iniciar sesión. El progreso público sigue disponible.
              </p>
            ) : null}
          </section>

          <section className="card p-5">
            <h2 className="text-sm font-bold text-surface-ink">Datos del trabajo</h2>
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-surface-muted">Archivo</dt>
                <dd className="max-w-[60%] truncate font-medium text-surface-ink">{readString(order?.file_name, '—')}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-surface-muted">Páginas / copias</dt>
                <dd className="font-medium tabular-nums text-surface-ink">
                  {readNumber(order?.pages, 0)} / {readNumber(order?.copies, 0)}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-surface-muted">Opciones</dt>
                <dd className="text-right font-medium text-surface-ink">
                  {order?.color ? 'Color' : 'B&N'} · {order?.duplex ? 'Dúplex' : 'Simple'} ·{' '}
                  {readString(order?.paper_size, 'A4')}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-surface-muted">Creada</dt>
                <dd className="font-medium text-surface-ink">{formatDateTime(order?.created_at)}</dd>
              </div>
            </dl>
          </section>

          <section className="card p-5">
            <div className="flex items-center gap-2">
              <FileSearch className="h-4 w-4 text-brand-600" aria-hidden="true" />
              <h2 className="text-sm font-bold text-surface-ink">Buscar otra orden</h2>
            </div>
            <form onSubmit={handleSearch} className="mt-3 flex gap-2">
              <input
                type="text"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="ID de orden (ord_…)"
                className="input"
                aria-label="ID de orden a rastrear"
              />
              <button type="submit" className="btn-primary" aria-label="Buscar orden">
                <Search className="h-4 w-4" aria-hidden="true" />
              </button>
            </form>
            <p className="mt-2 text-[11px] text-surface-muted">
              ID actual: <span className="font-mono">{shortId(id, 18)}</span>
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
