'use client';

import { ChevronRight, LayoutDashboard, LogOut, Menu, Printer, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut } from 'next-auth/react';
import { useState, type ComponentType, type ReactNode } from 'react';
import { StatusBadge } from '@/components/StatusBadge';
import { cn, initials } from '@/lib/utils';

export interface PanelNavItem {
  key: string;
  label: string;
  icon?: ComponentType<{ className?: string }>;
  href?: string;
  badge?: string | number;
  group?: string;
}

export interface PanelShellProps {
  title: string;
  subtitle?: string;
  items: PanelNavItem[];
  activeKey?: string;
  onSelect?: (key: string) => void;
  children: ReactNode;
  user?: { name?: string | null; email?: string | null; role?: string | null };
  toolbar?: ReactNode;
}

export function PanelShell({
  title,
  subtitle,
  items,
  activeKey,
  onSelect,
  children,
  user,
  toolbar,
}: PanelShellProps) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  function isActive(item: PanelNavItem) {
    if (activeKey) return activeKey === item.key;
    if (item.href === '/admin') return pathname === '/admin';
    if (item.href) return pathname.startsWith(item.href);
    return false;
  }

  function handleSelect(item: PanelNavItem) {
    onSelect?.(item.key);
    setOpen(false);
  }

  const groups = Array.from(new Set(items.map((item) => item.group ?? 'General')));

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center gap-2.5 border-b border-surface-border px-4">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-brand-600 to-accent-500 text-white">
          <Printer className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-extrabold text-white">PrintFlow ERP</p>
          <p className="truncate text-[10px] font-bold uppercase tracking-[0.16em] text-accent-100">Panel de control</p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="ml-auto rounded p-1 text-white/70 hover:bg-white/10 lg:hidden"
          aria-label="Cerrar menú lateral"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4" aria-label="Navegación del panel">
        {groups.map((group) => (
          <div key={group}>
            <p className="mb-1.5 px-2 text-[10px] font-bold uppercase tracking-widest text-white/45">{group}</p>
            <div className="space-y-0.5">
              {items
                .filter((item) => (item.group ?? 'General') === group)
                .map((item) => {
                  const Icon = item.icon ?? LayoutDashboard;
                  const active = isActive(item);
                  const content = (
                    <>
                      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                      <span className="flex-1 truncate text-left">{item.label}</span>
                      {item.badge !== undefined ? (
                        <span className="rounded-full bg-white/10 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-white">
                          {item.badge}
                        </span>
                      ) : null}
                    </>
                  );
                  const className = cn(
                    'flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition',
                    active
                      ? 'bg-brand-500 text-white shadow-sm'
                      : 'text-white/70 hover:bg-white/10 hover:text-white',
                  );
                  return item.href ? (
                    <Link key={item.key} href={item.href} onClick={() => handleSelect(item)} className={className}>
                      {content}
                    </Link>
                  ) : (
                    <button key={item.key} type="button" onClick={() => handleSelect(item)} className={className}>
                      {content}
                    </button>
                  );
                })}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-white/10 p-3">
        <div className="flex items-center gap-2.5 rounded-md bg-white/5 p-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-500/20 text-xs font-bold text-accent-100">
            {initials(user?.name ?? user?.email ?? 'U')}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold text-white">{user?.name ?? 'Usuario'}</p>
            <p className="truncate text-[11px] text-white/55">{user?.email ?? '—'}</p>
          </div>
          <button
            type="button"
            onClick={() => void signOut({ callbackUrl: '/login' })}
            className="rounded p-1.5 text-white/60 transition hover:bg-white/10 hover:text-white"
            title="Cerrar sesión"
            aria-label="Cerrar sesión"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-surface-light">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 bg-brand-700 lg:block">{sidebar}</aside>

      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-surface-ink/50"
            onClick={() => setOpen(false)}
            aria-label="Cerrar menú lateral"
          />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-brand-700 shadow-2xl">{sidebar}</aside>
        </div>
      ) : null}

      <div className="lg:pl-64">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-surface-border bg-white/95 px-4 backdrop-blur sm:px-6">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="rounded-md border border-surface-border p-2 text-surface-muted lg:hidden"
            aria-label="Abrir menú lateral"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-[11px] font-medium text-surface-muted">
              <span>Panel</span>
              <ChevronRight className="h-3 w-3" aria-hidden="true" />
              <span className="truncate text-brand-600">{title}</span>
            </div>
            <h1 className="truncate text-base font-bold text-surface-ink sm:text-lg">{title}</h1>
            {subtitle ? <p className="hidden truncate text-xs text-surface-muted sm:block">{subtitle}</p> : null}
          </div>
          <div className="flex items-center gap-2">
            {toolbar}
            {user?.role ? <StatusBadge status={user.role} size="md" className="hidden sm:inline-flex" /> : null}
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1600px] px-4 py-5 sm:px-6 lg:py-6">{children}</main>
      </div>
    </div>
  );
}
