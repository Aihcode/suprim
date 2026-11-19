'use client';

import {
  ClipboardList,
  CreditCard,
  Eye,
  Gift,
  History,
  LogOut,
  RefreshCw,
  UserCircle2,
} from 'lucide-react';
import Link from 'next/link';
import { signOut } from 'next-auth/react';
import { useEffect, useState, type ComponentType } from 'react';
import { DataTable, type Column } from '@/components/DataTable';
import { StatusBadge } from '@/components/StatusBadge';
import { StatCard } from '@/components/StatCard';
import { useApiList } from '@/components/useApiList';
import {
  apiFetch,
  asRecord,
  errorMessage,
  readNumber,
  readString,
  unwrapList,
  type FreePagesData,
  type Order,
} from '@/lib/client-api';
import { cn, formatCurrency, formatDate, initials, shortId } from '@/lib/utils';

type TabKey = 'orders' | 'free' | 'profile';

export interface ClientPortalProps {
  user: { name?: string | null; email?: string | null; role?: string | null };
}

const tabs: Array<{ key: TabKey; label: string; icon: ComponentType<{ className?: string }> }> = [
  { key: 'orders', label: 'Órdenes', icon: ClipboardList },
  { key: 'free', label: 'Impresiones gratis', icon: Gift },
  { key: 'profile', label: 'Perfil', icon: UserCircle2 },
];

export function ClientPortal({ user }: ClientPortalProps) {
  const [tab, setTab] = useState<TabKey>('orders');
  const {
    rows: orders,
    loading: ordersLoading,
    error: ordersError,
    reload: reloadOrders,
  } = useApiList<Order>('/api/client/orders?limit=100', ['orders']);

  const [free, setFree] = useState<FreePagesData | null>(null);
  const [freeLoading, setFreeLoading] = useState(false);
  const [freeError, setFreeError] = useState<string | null>(null);

  async function loadFree() {
    setFreeLoading(true);
    setFreeError(null);
    try {
      const data = await apiFetch<unknown>('/api/client/free-pages');
      setFree(asRecord(data) as FreePagesData);
    } catch (cause) {
      setFreeError(errorMessage(cause, 'No se pudo cargar tu saldo de páginas gratis.'));
    } finally {
      setFreeLoading(false);
    }
  }

  useEffect(() => {
    void loadFree();
  }, []);

  const history = unwrapList<Record<string, unknown>>(
    free?.history ?? free?.entries ?? [],
    ['history', 'entries', 'items'],
  );
  const balance = readNumber(free?.balance ?? free?.total, 0);

  const columns: Column<Order>[] = [
    {
      key: 'id',
      header: 'Orden',
      value: (row) => row.id,
      render: (row) => <span className="font-mono text-xs font-semibold text-brand-600">{shortId(row.id, 12)}</span>,
    },
    {
      key: 'file_name',
      header: 'Archivo',
      value: (row) => readString(row.file_name),
      render: (row) => <span className="block max-w-48 truncate text-xs">{readString(row.file_name, '—')}</span>,
    },
    {
      key: 'details',
      header: 'Detalles',
      value: (row) => `${readNumber(row.pages, 0)} páginas`,
      render: (row) => (
        <span className="text-xs text-surface-muted">
          {readNumber(row.pages, 0)} pág. · {readNumber(row.copies, 1)} copias · {row.color ? 'Color' : 'B&N'}
        </span>
      ),
      hideOnMobile: true,
    },
    {
      key: 'total_price',
      header: 'Total',
      value: (row) => readNumber(row.total_price, 0),
      render: (row) => <span className="font-medium tabular-nums">{formatCurrency(readNumber(row.total_price, 0))}</span>,
    },
    {
      key: 'status',
      header: 'Estado',
      value: (row) => readString(row.status),
      render: (row) => <StatusBadge status={readString(row.status)} />,
    },
    {
      key: 'created_at',
      header: 'Fecha',
      value: (row) => readString(row.created_at),
      render: (row) => <span className="text-xs text-surface-muted">{formatDate(row.created_at)}</span>,
      hideOnMobile: true,
    },
  ];

  return (
    <div className="section space-y-5 py-8 sm:py-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-widest text-brand-600">Portal del cliente</p>
          <h1 className="mt-1 text-2xl font-black tracking-tight text-surface-ink sm:text-3xl">
            Hola, {user.name?.split(' ')[0] ?? 'bienvenido'}
          </h1>
          <p className="mt-1 text-sm text-surface-muted">
            Gestiona tus impresiones y revisa tus beneficios desde aquí.
          </p>
        </div>
        <Link href="/quote" className="btn-primary">
          <CreditCard className="h-4 w-4" aria-hidden="true" /> Nueva impresión
        </Link>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Órdenes registradas" value={orders.length} icon={ClipboardList} tone="brand" />
        <StatCard label="Páginas gratis" value={balance} icon={Gift} tone="accent" hint="Disponibles para tus próximas cotizaciones" />
        <StatCard
          label="Órdenes completadas"
          value={orders.filter((order) => readString(order.status).toUpperCase() === 'COMPLETED').length}
          icon={History}
          tone="success"
        />
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-surface-border" role="tablist" aria-label="Secciones del portal">
        {tabs.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={tab === item.key}
              onClick={() => setTab(item.key)}
              className={cn(
                'inline-flex shrink-0 items-center gap-2 border-b-2 px-4 py-3 text-sm font-semibold transition',
                tab === item.key
                  ? 'border-brand-600 text-brand-600'
                  : 'border-transparent text-surface-muted hover:text-surface-ink',
              )}
            >
              <Icon className="h-4 w-4" aria-hidden="true" /> {item.label}
            </button>
          );
        })}
      </div>

      {tab === 'orders' ? (
        <section role="tabpanel">
          <DataTable
            rows={orders}
            columns={columns}
            keyExtractor={(row) => row.id}
            loading={ordersLoading}
            error={ordersError}
            onRetry={() => void reloadOrders()}
            searchable
            searchPlaceholder="Buscar por archivo, ID o estado…"
            emptyMessage="Todavía no tienes órdenes. ¡Haz tu primera impresión!"
            actions={(row) => (
              <div className="flex items-center gap-1">
                <Link
                  href={`/track/${encodeURIComponent(row.id)}`}
                  className="rounded p-1.5 text-surface-muted transition hover:bg-brand-50 hover:text-brand-600"
                  title="Rastrear orden"
                  aria-label={`Rastrear orden ${row.id}`}
                >
                  <Eye className="h-4 w-4" />
                </Link>
                <Link
                  href={`/checkout/${encodeURIComponent(row.id)}`}
                  className="rounded p-1.5 text-surface-muted transition hover:bg-accent-50 hover:text-accent-600"
                  title="Ver checkout"
                  aria-label={`Ver checkout de orden ${row.id}`}
                >
                  <CreditCard className="h-4 w-4" />
                </Link>
              </div>
            )}
          />
        </section>
      ) : null}

      {tab === 'free' ? (
        <section role="tabpanel" className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard label="Saldo disponible" value={balance} icon={Gift} tone="accent" />
            <StatCard label="Acumuladas" value={readNumber(free?.total, balance)} icon={History} tone="brand" />
            <StatCard label="Utilizadas" value={readNumber(free?.used, 0)} icon={ClipboardList} tone="warning" />
          </div>
          <div className="card overflow-hidden">
            <div className="flex items-center justify-between border-b border-surface-border px-4 py-3">
              <h2 className="text-sm font-bold text-surface-ink">Historial de páginas gratis</h2>
              <button type="button" onClick={() => void loadFree()} className="btn-ghost text-xs" disabled={freeLoading}>
                <RefreshCw className={cn('h-3.5 w-3.5', freeLoading && 'animate-spin')} aria-hidden="true" /> Actualizar
              </button>
            </div>
            {freeLoading ? (
              <div className="space-y-2 p-4">
                <div className="skeleton h-9 w-full rounded" />
                <div className="skeleton h-9 w-full rounded" />
              </div>
            ) : freeError ? (
              <p className="p-6 text-center text-sm text-danger-600">{freeError}</p>
            ) : history.length === 0 ? (
              <p className="p-8 text-center text-sm text-surface-muted">
                Aún no has acumulado páginas gratis. Cotiza trabajos de más páginas para obtenerlas.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-left text-sm">
                  <thead className="bg-surface-light text-[11px] uppercase tracking-wide text-surface-muted">
                    <tr>
                      <th className="px-4 py-3">Fecha</th>
                      <th className="px-4 py-3">Concepto</th>
                      <th className="px-4 py-3">Páginas</th>
                      <th className="px-4 py-3">Orden</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-border">
                    {history.map((entry, index) => (
                      <tr key={readString(entry.id, String(index))} className="hover:bg-surface-light/70">
                        <td className="px-4 py-3 text-xs text-surface-muted">{formatDate(readString(entry.created_at ?? entry.date))}</td>
                        <td className="px-4 py-3">{readString(entry.description ?? entry.reason ?? entry.type, 'Movimiento')}</td>
                        <td className="px-4 py-3 font-semibold tabular-nums text-accent-600">
                          {readNumber(entry.pages ?? entry.amount ?? entry.value, 0)}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-surface-muted">
                          {shortId(readString(entry.order_id), 10)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      ) : null}

      {tab === 'profile' ? (
        <section role="tabpanel" className="card max-w-2xl p-5">
          <div className="flex items-center gap-4">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-50 text-lg font-extrabold text-brand-600">
              {initials(user.name ?? user.email ?? 'U')}
            </span>
            <div>
              <p className="text-lg font-bold text-surface-ink">{user.name ?? 'Usuario'}</p>
              <p className="text-sm text-surface-muted">{user.email ?? '—'}</p>
              <div className="mt-1">
                <StatusBadge status={user.role ?? 'CLIENT'} size="sm" />
              </div>
            </div>
          </div>
          <div className="mt-5 grid gap-3 border-t border-surface-border pt-4 sm:grid-cols-2">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-surface-muted">Correo</p>
              <p className="mt-1 text-sm text-surface-ink">{user.email ?? '—'}</p>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-surface-muted">Tipo de cuenta</p>
              <p className="mt-1 text-sm text-surface-ink">{readString(user.role, 'Cliente')}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void signOut({ callbackUrl: '/login' })}
            className="btn-secondary mt-5 text-danger-600"
          >
            <LogOut className="h-4 w-4" aria-hidden="true" /> Cerrar sesión
          </button>
        </section>
      ) : null}
    </div>
  );
}
