import { StatusBadge } from '@/components/StatusBadge';
import { cn } from '@/lib/utils';

export interface LivePrinterBadgeProps {
  status?: string | null;
  lastSeen?: string | null;
  label?: string;
  className?: string;
}

/**
 * Badge de conexión en vivo. Usa turquesa (acento) para estaciones online,
 * ámbar para estados de advertencia y rojo para desconexiones/errores.
 */
export function LivePrinterBadge({
  status,
  lastSeen,
  label,
  className,
}: LivePrinterBadgeProps) {
  const key = (status ?? '').toUpperCase();
  const connected = ['ONLINE', 'PRINTING', 'READY'].includes(key);
  const disconnected = ['OFFLINE', 'ERROR', 'JAM', 'NO_PAPER', 'CANCELLED'].includes(key);
  const warning = ['PAUSED', 'LOW_TONER'].includes(key);

  let seenRecently = false;
  if (lastSeen) {
    const time = new Date(lastSeen).getTime();
    seenRecently = Number.isFinite(time) && Date.now() - time < 90_000;
  }

  const isOnline = connected || (!disconnected && (seenRecently || (!status && !lastSeen)));

  const toneClass = isOnline
    ? 'bg-accent-500/10 text-accent-600 ring-accent-500/30'
    : warning
      ? 'bg-warning-500/10 text-warning-600 ring-warning-500/30'
      : 'bg-danger-500/10 text-danger-600 ring-danger-500/30';

  return (
    <StatusBadge
      status={isOnline ? 'ONLINE' : key || 'OFFLINE'}
      label={label ?? (isOnline ? 'online' : warning ? 'advertencia' : 'offline')}
      className={cn(toneClass, isOnline && '[&>span:first-child]:animate-pulse-dot', className)}
    />
  );
}
