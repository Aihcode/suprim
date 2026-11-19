import type { ComponentType, ReactNode } from 'react';
import { cn } from '@/lib/utils';

type Tone = 'brand' | 'accent' | 'success' | 'warning' | 'danger';

const toneStyles: Record<Tone, string> = {
  brand: 'bg-brand-500/10 text-brand-600',
  accent: 'bg-accent-500/10 text-accent-600',
  success: 'bg-success-500/10 text-success-600',
  warning: 'bg-warning-500/10 text-warning-600',
  danger: 'bg-danger-500/10 text-danger-600',
};

export interface StatCardProps {
  label: string;
  value: ReactNode;
  hint?: string;
  icon?: ComponentType<{ className?: string }>;
  tone?: Tone;
  className?: string;
}

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'brand',
  className,
}: StatCardProps) {
  return (
    <div className={cn('card flex items-start justify-between gap-3 p-4 sm:p-5', className)}>
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-wide text-surface-muted">{label}</p>
        <p className="mt-2 truncate text-2xl font-bold tabular-nums text-surface-ink">{value}</p>
        {hint ? <p className="mt-1 text-xs text-surface-muted">{hint}</p> : null}
      </div>
      {Icon ? (
        <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-lg', toneStyles[tone])}>
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
      ) : null}
    </div>
  );
}
