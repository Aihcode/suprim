import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  Download,
  PackageCheck,
  Printer,
} from 'lucide-react';
import type { JobProgress } from '@/lib/client-api';
import { cn, formatDateTime } from '@/lib/utils';

export interface OrderTimelineProps {
  progress?: JobProgress | null;
  history?: JobProgress[];
  orderStatus?: string;
  compact?: boolean;
  className?: string;
}

interface Step {
  key: string;
  label: string;
  description: string;
  icon: typeof Clock3;
}

const steps: Step[] = [
  {
    key: 'RECEIVED',
    label: 'Recibido en estación',
    description: 'El trabajo fue aceptado por la estación de impresión.',
    icon: PackageCheck,
  },
  {
    key: 'DOWNLOADING',
    label: 'Descargando',
    description: 'Descargando y preparando el documento de forma segura.',
    icon: Download,
  },
  {
    key: 'PRINTING',
    label: 'Imprimiendo',
    description: 'El agente está imprimiendo página por página.',
    icon: Printer,
  },
  {
    key: 'COMPLETED',
    label: 'Completado',
    description: 'La impresión finalizó correctamente.',
    icon: CheckCircle2,
  },
];

function stepIndex(status: string | undefined): number {
  switch ((status ?? '').toUpperCase()) {
    case 'RECEIVED':
    case 'LOCAL_QUEUE':
      return 0;
    case 'DOWNLOADING':
      return 1;
    case 'PRINTING':
      return 2;
    case 'COMPLETED':
      return 3;
    default:
      return -1;
  }
}

export function OrderTimeline({
  progress,
  history = [],
  orderStatus,
  compact = false,
  className,
}: OrderTimelineProps) {
  const status = (progress?.status ?? orderStatus ?? '').toUpperCase();
  const failed = ['FAILED', 'CANCELLED', 'ERROR'].includes(status);
  const current = stepIndex(progress?.status);
  const orderState = (orderStatus ?? '').toUpperCase();
  const notStarted = current < 0 && !failed && ['PENDING', 'PAID'].includes(orderState);
  const station = progress?.station_name ?? progress?.station_id ?? 'PC-01';
  const currentPage = Math.max(0, Number(progress?.page_current ?? 0));
  const totalPages = Math.max(0, Number(progress?.page_total ?? 0));
  const percent = totalPages > 0 ? Math.min(100, Math.round((currentPage / totalPages) * 100)) : 0;

  return (
    <div className={cn('space-y-4', className)}>
      {failed ? (
        <div className="flex items-start gap-2 rounded-lg border border-danger-500/25 bg-danger-500/5 p-3 text-sm text-danger-600">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{progress?.message ?? 'La impresión no pudo completarse. Contacta con soporte.'}</span>
        </div>
      ) : null}

      {notStarted ? (
        <div className="flex items-start gap-2 rounded-lg border border-warning-500/25 bg-warning-500/5 p-3 text-sm text-warning-600">
          <Clock3 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            {orderState === 'PENDING'
              ? 'Tu pago está pendiente. En cuanto se confirme, enviaremos el trabajo a la estación.'
              : 'Pago confirmado. Esperando a que una estación reciba el trabajo.'}
          </span>
        </div>
      ) : null}

      <ol className="relative space-y-0">
        {steps.map((step, index) => {
          const done = current > index || status === 'COMPLETED';
          const active = current === index && status !== 'COMPLETED';
          const Icon = step.icon;
          const label = index === 0 ? `Recibido en estación ${station}` : step.label;
          return (
            <li key={step.key} className="relative flex gap-3 pb-4 last:pb-0">
              {index < steps.length - 1 ? (
                <span
                  className={cn(
                    'absolute left-[13px] top-7 h-[calc(100%-16px)] w-0.5',
                    done ? 'bg-brand-500' : 'bg-surface-border',
                  )}
                  aria-hidden="true"
                />
              ) : null}
              <span
                className={cn(
                  'relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ring-4 ring-white',
                  done && 'bg-success-500 text-white',
                  active && 'bg-brand-500 text-white',
                  !done && !active && 'bg-surface-mid text-surface-muted',
                )}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
              </span>
              <div className="min-w-0 pt-0.5">
                <p
                  className={cn(
                    'text-sm font-semibold',
                    done || active ? 'text-surface-ink' : 'text-surface-muted',
                  )}
                >
                  {label}
                </p>
                {!compact ? (
                  <p className="mt-0.5 text-xs leading-relaxed text-surface-muted">
                    {step.description}
                  </p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>

      {totalPages > 0 ? (
        <div className="rounded-lg border border-surface-border bg-surface-light p-3">
          <div className="flex items-center justify-between text-xs font-medium text-surface-muted">
            <span>
              Página {currentPage} de {totalPages}
            </span>
            <span>{percent}%</span>
          </div>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-white ring-1 ring-inset ring-surface-border">
            <div
              className="h-full rounded-full bg-gradient-to-r from-brand-500 to-accent-500 transition-all duration-500"
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>
      ) : null}

      {progress?.message && !failed ? (
        <p className="text-xs text-surface-muted">{progress.message}</p>
      ) : null}

      {history.length > 0 ? (
        <div className="border-t border-surface-border pt-3">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-surface-muted">
            Historial de eventos
          </p>
          <ul className="max-h-40 space-y-1 overflow-y-auto text-xs text-surface-muted">
            {history.slice(0, 12).map((event, index) => (
              <li key={`${event.timestamp ?? index}-${index}`} className="flex justify-between gap-3">
                <span className="truncate">{event.message ?? event.status ?? 'Evento'}</span>
                <span className="shrink-0 tabular-nums">{formatDateTime(event.timestamp)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
