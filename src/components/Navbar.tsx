'use client';

import {
  ChevronDown,
  LayoutDashboard,
  LogOut,
  Menu,
  Printer,
  ShieldCheck,
  UserCircle2,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession, signOut } from 'next-auth/react';
import { useState } from 'react';
import { cn, initials } from '@/lib/utils';

const links = [
  { href: '/', label: 'Inicio' },
  { href: '/quote', label: 'Cotizador' },
  { href: '/#como-funciona', label: 'Cómo funciona' },
  { href: '/client', label: 'Portal cliente' },
];

export function Navbar() {
  const { data: session, status } = useSession();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);

  const user = session?.user as { name?: string | null; email?: string | null; role?: string } | undefined;
  const role = user?.role ?? '';
  const panelHref = role === 'ADMIN' ? '/admin' : role === 'EMPLOYEE' ? '/employee' : '/client';
  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : href.startsWith('/#') ? false : pathname.startsWith(href);

  return (
    <header className="sticky top-0 z-40 border-b border-surface-border bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/85">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <Link href="/" className="flex items-center gap-2.5" onClick={() => setMenuOpen(false)}>
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-brand-600 to-accent-500 text-white shadow-sm">
            <Printer className="h-5 w-5" aria-hidden="true" />
          </span>
          <span className="leading-tight">
            <span className="block text-sm font-extrabold tracking-tight text-surface-ink">PrintFlow</span>
            <span className="block text-[10px] font-bold uppercase tracking-[0.16em] text-accent-600">
              ERP &amp; PrintBridge
            </span>
          </span>
        </Link>

        <nav className="hidden items-center gap-1 lg:flex" aria-label="Navegación principal">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                'rounded-md px-3 py-2 text-sm font-medium transition',
                isActive(link.href)
                  ? 'bg-brand-50 text-brand-600'
                  : 'text-surface-muted hover:bg-surface-mid hover:text-surface-ink',
              )}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-2 sm:flex">
          {status === 'authenticated' ? (
            <div className="relative">
              <button
                type="button"
                onClick={() => setAccountOpen((open) => !open)}
                className="flex items-center gap-2 rounded-lg border border-surface-border bg-white px-2.5 py-1.5 text-sm transition hover:bg-surface-light"
                aria-expanded={accountOpen}
                aria-haspopup="menu"
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-50 text-[11px] font-bold text-brand-600">
                  {initials(user?.name ?? user?.email ?? 'U')}
                </span>
                <span className="max-w-28 truncate font-medium text-surface-ink">
                  {user?.name ?? user?.email ?? 'Mi cuenta'}
                </span>
                <ChevronDown className="h-4 w-4 text-surface-muted" aria-hidden="true" />
              </button>
              {accountOpen ? (
                <div
                  className="absolute right-0 top-full mt-2 w-56 overflow-hidden rounded-lg border border-surface-border bg-white py-1 shadow-card"
                  role="menu"
                >
                  <Link href="/client" className="block px-4 py-2 text-sm text-surface-ink hover:bg-surface-light" role="menuitem" onClick={() => setAccountOpen(false)}>
                    Portal cliente
                  </Link>
                  {role === 'EMPLOYEE' || role === 'ADMIN' ? (
                    <Link href={panelHref} className="block px-4 py-2 text-sm text-surface-ink hover:bg-surface-light" role="menuitem" onClick={() => setAccountOpen(false)}>
                      Panel de trabajo
                    </Link>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => void signOut({ callbackUrl: '/login' })}
                    className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-danger-600 hover:bg-danger-500/5"
                    role="menuitem"
                  >
                    <LogOut className="h-4 w-4" aria-hidden="true" /> Cerrar sesión
                  </button>
                </div>
              ) : null}
            </div>
          ) : (
            <>
              <Link href="/login" className="btn-ghost">
                Iniciar sesión
              </Link>
              <Link href="/register" className="btn-primary">
                Crear cuenta
              </Link>
            </>
          )}
        </div>

        <button
          type="button"
          className="rounded-md border border-surface-border p-2 text-surface-muted lg:hidden"
          onClick={() => setMenuOpen((open) => !open)}
          aria-expanded={menuOpen}
          aria-label={menuOpen ? 'Cerrar menú' : 'Abrir menú'}
        >
          {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {menuOpen ? (
        <div className="border-t border-surface-border bg-white px-4 py-3 lg:hidden">
          <nav className="flex flex-col gap-1" aria-label="Navegación móvil">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMenuOpen(false)}
                className={cn(
                  'rounded-md px-3 py-2 text-sm font-medium',
                  isActive(link.href) ? 'bg-brand-50 text-brand-600' : 'text-surface-muted hover:bg-surface-mid',
                )}
              >
                {link.label}
              </Link>
            ))}
            <div className="mt-2 flex flex-col gap-2 border-t border-surface-border pt-3">
              {status === 'authenticated' ? (
                <>
                  <Link href="/client" onClick={() => setMenuOpen(false)} className="btn-secondary justify-center">
                    <UserCircle2 className="h-4 w-4" aria-hidden="true" /> Portal cliente
                  </Link>
                  {(role === 'EMPLOYEE' || role === 'ADMIN') && (
                    <Link href={panelHref} onClick={() => setMenuOpen(false)} className="btn-secondary justify-center">
                      <LayoutDashboard className="h-4 w-4" aria-hidden="true" /> Panel de trabajo
                    </Link>
                  )}
                  <button type="button" onClick={() => void signOut({ callbackUrl: '/login' })} className="btn-ghost justify-center text-danger-600">
                    <LogOut className="h-4 w-4" aria-hidden="true" /> Cerrar sesión
                  </button>
                </>
              ) : (
                <>
                  <Link href="/login" onClick={() => setMenuOpen(false)} className="btn-secondary justify-center">
                    Iniciar sesión
                  </Link>
                  <Link href="/register" onClick={() => setMenuOpen(false)} className="btn-primary justify-center">
                    Crear cuenta
                  </Link>
                </>
              )}
              <p className="mt-1 flex items-center justify-center gap-1.5 text-[11px] text-surface-muted">
                <ShieldCheck className="h-3.5 w-3.5 text-success-600" aria-hidden="true" /> Pago seguro Stripe · PayPal
              </p>
            </div>
          </nav>
        </div>
      ) : null}
    </header>
  );
}
