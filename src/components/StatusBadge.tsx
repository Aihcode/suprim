import { cn } from '@/lib/utils';

type Tone = 'success' | 'info' | 'warning' | 'danger' | 'neutral';

const toneStyles: Record<Tone, string> = {
  success: 'bg-success-500/10 text-success-600 ring-success-500/25',
  info: 'bg-accent-500/10 text-accent-600 ring-accent-500/25',
  warning: 'bg-warning-500/10 text-warning-600 ring-warning-500/25',
  danger: 'bg-danger-500/10 text-danger-600 ring-danger-500/25',
  neutral: 'bg-surface-mid text-surface-muted ring-surface-border',
};

const statusMap: Record<string, { label: string; tone: Tone }> = {
  PENDING: { label: 'Pendiente', tone: 'warning' },
  AWAITING_PAYMENT: { label: 'Esperando pago', tone: 'warning' },
  PAID: { label: 'Pagado', tone: 'success' },
  PROCESSING: { label: 'En proceso', tone: 'info' },
  QUEUED: { label: 'En cola', tone: 'warning' },
  COMPLETED: { label: 'Completado', tone: 'success' },
  FAILED: { label: 'Fallido', tone: 'danger' },
  CANCELLED: { label: 'Cancelado', tone: 'danger' },
  REFUNDED: { label: 'Reembolsado', tone: 'neutral' },
  ONLINE: { label: 'En línea', tone: 'success' },
  OFFLINE: { label: 'Desconectado', tone: 'danger' },
  PRINTING: { label: 'Imprimiendo', tone: 'info' },
  DOWNLOADING: { label: 'Descargando', tone: 'info' },
  RECEIVED: { label: 'Recibido', tone: 'info' },
  LOCAL_QUEUE: { label: 'Cola local', tone: 'warning' },
  PAUSED: { label: 'Pausada', tone: 'warning' },
  NO_PAPER: { label: 'Sin papel', tone: 'danger' },
  JAM: { label: 'Atasco', tone: 'danger' },
  LOW_TONER: { label: 'Tóner bajo', tone: 'warning' },
  ERROR: { label: 'Error', tone: 'danger' },
  ACTIVE: { label: 'Activo', tone: 'success' },
  INACTIVE: { label: 'Inactivo', tone: 'neutral' },
  LOCAL: { label: 'Local', tone: 'info' },
  NETWORK: { label: 'Red', tone: 'info' },
  SHARED: { label: 'Compartida', tone: 'info' },
  ADMIN: { label: 'Administrador', tone: 'info' },
  EMPLOYEE: { label: 'Empleado', tone: 'info' },
  CLIENT: { label: 'Cliente', tone: 'neutral' },
  PERCENTAGE: { label: 'Porcentaje', tone: 'info' },
  FIXED: { label: 'Monto fijo', tone: 'info' },
  FREE_PAGES: { label: 'Páginas gratis', tone: 'success' },
  STRIPE: { label: 'Stripe', tone: 'info' },
  PAYPAL: { label: 'PayPal', tone: 'info' },
  DEMO: { label: 'Demo', tone: 'neutral' },
};

export interface StatusBadgeProps {
  status?: string | null;
  label?: string;
  size?: 'sm' | 'md';
  dot?: boolean;
  className?: string;
}

export function StatusBadge({
  status,
  label,
  size = 'sm',
  dot = true,
  className,
}: StatusBadgeProps) {
  const key = (status ?? '').toUpperCase();
  const mapped = statusMap[key];
  const tone = mapped?.tone ?? 'neutral';
  const text = label ?? mapped?.label ?? (key || 'Sin estado');

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full font-medium ring-1 ring-inset whitespace-nowrap',
        size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs',
        toneStyles[tone],
        className,
      )}
    >
      {dot ? <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" /> : null}
      {text}
    </span>
  );
}
