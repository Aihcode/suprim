'use client';

import {
  BarChart3,
  CheckCircle2,
  ClipboardList,
  Copy,
  Cpu,
  LayoutDashboard,
  Loader2,
  Monitor,
  Pause,
  Play,
  Plus,
  Printer as PrinterIcon,
  RefreshCw,
  RotateCcw,
  Save,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { DataTable, type Column } from '@/components/DataTable';
import { LivePrinterBadge } from '@/components/LivePrinterBadge';
import { Modal } from '@/components/Modal';
import { PanelShell, type PanelNavItem } from '@/components/PanelShell';
import { StatusBadge } from '@/components/StatusBadge';
import { StatCard } from '@/components/StatCard';
import { useToast } from '@/components/ToastProvider';
import { useApiList } from '@/components/useApiList';
import {
  apiFetch,
  asRecord,
  errorMessage,
  readNumber,
  readString,
  type Order,
  type Printer,
  type Station,
} from '@/lib/client-api';
import { cn, formatCurrency, formatDateTime, maskToken, relativeTime, shortId } from '@/lib/utils';

type View = 'overview' | 'stations' | 'printers' | 'orders';
type ConfirmTarget = { kind: 'station'; id: string; label: string } | null;

interface StationForm {
  id?: string;
  name: string;
  computer_name: string;
  os: string;
}

interface PrinterForm {
  id?: string;
  name: string;
  type: string;
  ip: string;
  port: string;
  protocol: string;
  capabilities: string;
}

interface OrderForm {
  id: string;
  status: string;
  station_id: string;
  printer_id: string;
}

const emptyStation: StationForm = { name: '', computer_name: '', os: 'WINDOWS' };
const emptyPrinter: PrinterForm = {
  name: '',
  type: 'LOCAL',
  ip: '',
  port: '9100',
  protocol: 'RAW',
  capabilities: '{"color":true,"duplex":true,"trays":["default"],"paper_sizes":["A4","Letter"]}',
};

function isStationOnline(station: Station): boolean {
  if (!station.last_seen) return false;
  const time = new Date(station.last_seen).getTime();
  return Number.isFinite(time) && Date.now() - time < 90_000;
}

function capabilitiesText(value: unknown): string {
  if (typeof value === 'string') return value;
  return JSON.stringify(value ?? {});
}

export interface EmployeePanelProps {
  user: { name?: string | null; email?: string | null; role?: string | null };
}

export function EmployeePanel({ user }: EmployeePanelProps) {
  const { toast } = useToast();
  const [view, setView] = useState<View>('overview');
  const [filters, setFilters] = useState({ status: '', station: '', printer: '' });

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (filters.status) params.set('status', filters.status);
    if (filters.station) params.set('station_id', filters.station);
    if (filters.printer) params.set('printer_id', filters.printer);
    const value = params.toString();
    return value ? `?${value}` : '';
  }, [filters]);

  const stations = useApiList<Station>('/api/employee/stations', ['stations']);
  const printers = useApiList<Printer>('/api/employee/printers', ['printers']);
  const orders = useApiList<Order>(`/api/employee/orders${query}`, ['orders']);

  const [stationForm, setStationForm] = useState<StationForm | null>(null);
  const [printerForm, setPrinterForm] = useState<PrinterForm | null>(null);
  const [orderForm, setOrderForm] = useState<OrderForm | null>(null);
  const [confirm, setConfirm] = useState<ConfirmTarget>(null);
  const [busy, setBusy] = useState(false);

  async function mutate(path: string, init: RequestInit, successMessage: string) {
    setBusy(true);
    try {
      await apiFetch(path, init);
      toast({ title: 'Operación completada', description: successMessage, variant: 'success' });
      await Promise.all([stations.reload(true), printers.reload(true), orders.reload(true)]);
      return true;
    } catch (cause) {
      toast({ title: 'No se pudo completar', description: errorMessage(cause), variant: 'error' });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function submitStation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!stationForm) return;
    const body = JSON.stringify({
      name: stationForm.name,
      computer_name: stationForm.computer_name,
      os: stationForm.os,
    });
    const ok = await mutate(
      stationForm.id ? `/api/employee/stations/${encodeURIComponent(stationForm.id)}` : '/api/employee/stations',
      { method: stationForm.id ? 'PATCH' : 'POST', body },
      stationForm.id ? 'Estación actualizada.' : 'Estación registrada.',
    );
    if (ok) setStationForm(null);
  }

  async function submitPrinter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!printerForm) return;
    let capabilities: unknown;
    try {
      capabilities = JSON.parse(printerForm.capabilities || '{}') as unknown;
    } catch {
      toast({ title: 'Capacidades inválidas', description: 'Escribe un JSON válido.', variant: 'warning' });
      return;
    }
    const body = JSON.stringify({
      name: printerForm.name,
      type: printerForm.type,
      ip: printerForm.ip || null,
      port: printerForm.port ? Number(printerForm.port) : null,
      protocol: printerForm.protocol,
      capabilities,
    });
    const ok = await mutate(
      printerForm.id ? `/api/employee/printers/${encodeURIComponent(printerForm.id)}` : '/api/employee/printers',
      { method: printerForm.id ? 'PATCH' : 'POST', body },
      printerForm.id ? 'Impresora actualizada.' : 'Impresora registrada.',
    );
    if (ok) setPrinterForm(null);
  }

  async function submitOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!orderForm) return;
    const ok = await mutate(
      `/api/employee/orders/${encodeURIComponent(orderForm.id)}`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          status: orderForm.status || undefined,
          station_id: orderForm.station_id || undefined,
          printer_id: orderForm.printer_id || undefined,
        }),
      },
      'Orden reasignada correctamente.',
    );
    if (ok) setOrderForm(null);
  }

  async function confirmDelete() {
    if (!confirm) return;
    const ok = await mutate(
      `/api/employee/stations/${encodeURIComponent(confirm.id)}`,
      { method: 'DELETE' },
      'Estación eliminada.',
    );
    if (ok) setConfirm(null);
  }

  async function copyToken(token: string) {
    try {
      await navigator.clipboard.writeText(token);
      toast({ title: 'Token copiado', variant: 'success' });
    } catch {
      toast({ title: 'No se pudo copiar el token', variant: 'warning' });
    }
  }

  const stationColumns: Column<Station>[] = [
    {
      key: 'name',
      header: 'Estación',
      value: (row) => readString(row.name),
      render: (row) => (
        <div className="flex items-center gap-2">
          <Monitor className="h-4 w-4 text-brand-600" aria-hidden="true" />
          <div>
            <p className="text-sm font-semibold text-surface-ink">{readString(row.name, '—')}</p>
            <p className="text-[11px] text-surface-muted">{readString(row.computer_name, 'Sin equipo')}</p>
          </div>
        </div>
      ),
    },
    { key: 'os', header: 'Sistema', value: (row) => readString(row.os), render: (row) => <StatusBadge status={readString(row.os)} label={readString(row.os)} /> },
    {
      key: 'last_seen',
      header: 'Última conexión',
      value: (row) => readString(row.last_seen),
      render: (row) => (
        <span className="text-xs text-surface-muted">
          {relativeTime(row.last_seen)} <LivePrinterBadge status={isStationOnline(row) ? 'ONLINE' : 'OFFLINE'} />
        </span>
      ),
    },
    {
      key: 'token',
      header: 'Token',
      value: (row) => readString(row.token),
      render: (row) => (
        <button
          type="button"
          onClick={() => void copyToken(readString(row.token))}
          className="inline-flex items-center gap-1.5 rounded px-1.5 py-1 font-mono text-[11px] text-surface-muted hover:bg-surface-light hover:text-brand-600"
          title="Copiar token de estación"
        >
          {maskToken(readString(row.token))} <Copy className="h-3 w-3" aria-hidden="true" />
        </button>
      ),
      hideOnMobile: true,
    },
  ];

  const printerColumns: Column<Printer>[] = [
    {
      key: 'name',
      header: 'Impresora',
      value: (row) => readString(row.name),
      render: (row) => (
        <div className="flex items-center gap-2">
          <PrinterIcon className="h-4 w-4 text-brand-600" aria-hidden="true" />
          <div>
            <p className="text-sm font-semibold text-surface-ink">{readString(row.name, '—')}</p>
            <p className="text-[11px] text-surface-muted">
              {readString(row.ip) || 'Local'} {row.port ? `:${readNumber(row.port)}` : ''}
            </p>
          </div>
        </div>
      ),
    },
    { key: 'type', header: 'Tipo', value: (row) => readString(row.type), render: (row) => <StatusBadge status={readString(row.type)} /> },
    {
      key: 'protocol',
      header: 'Protocolo',
      value: (row) => readString(row.protocol),
      render: (row) => <span className="text-xs text-surface-muted">{readString(row.protocol, '—')}</span>,
      hideOnMobile: true,
    },
    { key: 'status', header: 'Estado', value: (row) => readString(row.status), render: (row) => <LivePrinterBadge status={readString(row.status)} /> },
    {
      key: 'capabilities',
      header: 'Capacidades',
      value: (row) => capabilitiesText(row.capabilities),
      render: (row) => (
        <span className="block max-w-52 truncate text-[11px] text-surface-muted" title={capabilitiesText(row.capabilities)}>
          {capabilitiesText(row.capabilities)}
        </span>
      ),
      hideOnMobile: true,
    },
  ];

  const orderColumns: Column<Order>[] = [
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
      render: (row) => <span className="block max-w-44 truncate text-xs">{readString(row.file_name, '—')}</span>,
    },
    {
      key: 'pages',
      header: 'Trabajo',
      value: (row) => readNumber(row.pages, 0),
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
      render: (row) => <span className="tabular-nums text-xs font-medium">{formatCurrency(readNumber(row.total_price, 0))}</span>,
    },
    { key: 'status', header: 'Estado', value: (row) => readString(row.status), render: (row) => <StatusBadge status={readString(row.status)} /> },
    {
      key: 'created_at',
      header: 'Creada',
      value: (row) => readString(row.created_at),
      render: (row) => <span className="text-xs text-surface-muted">{formatDateTime(row.created_at)}</span>,
      hideOnMobile: true,
    },
  ];

  const statusChart = useMemo(() => {
    const counts: Record<string, number> = {};
    orders.rows.forEach((order) => {
      const key = readString(order.status, 'SIN ESTADO');
      counts[key] = (counts[key] ?? 0) + 1;
    });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [orders.rows]);

  const navItems: PanelNavItem[] = [
    { key: 'overview', label: 'Resumen', icon: LayoutDashboard, group: 'General' },
    { key: 'stations', label: 'Estaciones', icon: Cpu, group: 'Operación', badge: stations.rows.length },
    { key: 'printers', label: 'Impresoras', icon: PrinterIcon, group: 'Operación', badge: printers.rows.length },
    { key: 'orders', label: 'Cola global', icon: ClipboardList, group: 'Operación', badge: orders.rows.length },
  ];

  const titles: Record<View, { title: string; subtitle: string }> = {
    overview: { title: 'Resumen de operación', subtitle: 'Estado general de estaciones, impresoras y cola de trabajo.' },
    stations: { title: 'Estaciones PrintBridge', subtitle: 'Computadoras conectadas y tokens de autenticación.' },
    printers: { title: 'Impresoras', subtitle: 'Dispositivos locales, de red y compartidos.' },
    orders: { title: 'Cola global de órdenes', subtitle: 'Asigna recursos y libera impresiones en mostrador.' },
  };

  return (
    <PanelShell
      title={titles[view].title}
      subtitle={titles[view].subtitle}
      items={navItems}
      activeKey={view}
      onSelect={(key) => setView(key as View)}
      user={user}
      toolbar={
        <button
          type="button"
          onClick={() => void Promise.all([stations.reload(), printers.reload(), orders.reload()])}
          className="btn-secondary px-2.5 py-1.5 text-xs"
          title="Actualizar datos"
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> <span className="hidden sm:inline">Actualizar</span>
        </button>
      }
    >
      {view === 'overview' ? (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Estaciones en línea" value={stations.rows.filter(isStationOnline).length} hint={`${stations.rows.length} registradas`} icon={Cpu} tone="accent" />
            <StatCard label="Impresoras activas" value={printers.rows.filter((p) => ['ONLINE', 'PRINTING'].includes(readString(p.status).toUpperCase())).length} hint={`${printers.rows.length} en total`} icon={PrinterIcon} tone="success" />
            <StatCard label="Órdenes pendientes" value={orders.rows.filter((o) => readString(o.status).toUpperCase() === 'PENDING').length} icon={ClipboardList} tone="warning" />
            <StatCard label="Ingresos en cola" value={formatCurrency(orders.rows.reduce((sum, o) => sum + readNumber(o.total_price, 0), 0))} icon={BarChart3} tone="brand" />
          </div>
          <div className="grid gap-5 lg:grid-cols-[1.4fr_0.6fr]">
            <div className="card p-5">
              <h2 className="text-sm font-bold text-surface-ink">Órdenes por estado</h2>
              {statusChart.length === 0 ? (
                <p className="py-16 text-center text-sm text-surface-muted">Sin datos para graficar.</p>
              ) : (
                <div className="mt-4 h-60">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={statusChart} margin={{ top: 8, right: 8, bottom: 8, left: -20 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Bar dataKey="value" fill="#2563EB" radius={[4, 4, 0, 0]} name="Órdenes" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
            <div className="space-y-3">
              <div className="card p-5">
                <h2 className="text-sm font-bold text-surface-ink">Accesos rápidos</h2>
                <div className="mt-3 grid gap-2">
                  <button type="button" onClick={() => setView('stations')} className="btn-secondary justify-start"><Cpu className="h-4 w-4" /> Gestionar estaciones</button>
                  <button type="button" onClick={() => setView('printers')} className="btn-secondary justify-start"><PrinterIcon className="h-4 w-4" /> Revisar impresoras</button>
                  <button type="button" onClick={() => setView('orders')} className="btn-secondary justify-start"><ClipboardList className="h-4 w-4" /> Ver cola global</button>
                </div>
              </div>
              <div className="card border-accent-500/30 bg-accent-50/40 p-5">
                <TriangleAlert className="h-5 w-5 text-accent-600" aria-hidden="true" />
                <p className="mt-2 text-sm font-bold text-surface-ink">Atención a la cola</p>
                <p className="mt-1 text-xs leading-relaxed text-surface-muted">
                  Reasigna trabajos cuando una impresora se quede sin papel o libera impresiones en
                  mostrador desde la pestaña «Cola global».
                </p>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {view === 'stations' ? (
        <DataTable
          rows={stations.rows}
          columns={stationColumns}
          keyExtractor={(row, index) => readString(row.id, String(index))}
          loading={stations.loading}
          error={stations.error}
          onRetry={() => void stations.reload()}
          searchable
          searchPlaceholder="Buscar estación…"
          emptyMessage="No hay estaciones registradas. Registra una para empezar."
          toolbar={
            <button type="button" className="btn-primary text-xs" onClick={() => setStationForm({ ...emptyStation })}>
              <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Registrar estación
            </button>
          }
          actions={(row) => {
            const active = row.active ?? row.is_active ?? true;
            return (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  className="rounded p-1.5 text-surface-muted hover:bg-brand-50 hover:text-brand-600 disabled:opacity-50"
                  onClick={() => void mutate(`/api/employee/stations/${encodeURIComponent(readString(row.id))}`, { method: 'PATCH', body: JSON.stringify({ active: !active, is_active: !active }) }, active ? 'Estación desactivada.' : 'Estación activada.')}
                  disabled={busy}
                  title={active ? 'Desactivar estación' : 'Activar estación'}
                  aria-label={active ? 'Desactivar estación' : 'Activar estación'}
                >
                  {active ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                </button>
                <button
                  type="button"
                  className="rounded p-1.5 text-surface-muted hover:bg-brand-50 hover:text-brand-600"
                  onClick={() => setStationForm({ id: readString(row.id), name: readString(row.name), computer_name: readString(row.computer_name), os: readString(row.os, 'WINDOWS') })}
                  title="Editar estación"
                  aria-label={`Editar estación ${readString(row.name)}`}
                >
                  <Save className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  className="rounded p-1.5 text-surface-muted hover:bg-danger-500/10 hover:text-danger-600"
                  onClick={() => setConfirm({ kind: 'station', id: readString(row.id), label: readString(row.name, 'esta estación') })}
                  title="Eliminar estación"
                  aria-label={`Eliminar estación ${readString(row.name)}`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            );
          }}
        />
      ) : null}

      {view === 'printers' ? (
        <DataTable
          rows={printers.rows}
          columns={printerColumns}
          keyExtractor={(row, index) => readString(row.id, String(index))}
          loading={printers.loading}
          error={printers.error}
          onRetry={() => void printers.reload()}
          searchable
          searchPlaceholder="Buscar impresora…"
          emptyMessage="No hay impresoras registradas todavía."
          toolbar={
            <button type="button" className="btn-primary text-xs" onClick={() => setPrinterForm({ ...emptyPrinter })}>
              <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Registrar impresora
            </button>
          }
          actions={(row) => (
            <div className="flex items-center gap-1">
              <button
                type="button"
                className="btn-secondary px-2 py-1 text-[11px]"
                disabled={busy}
                onClick={() => void mutate(`/api/employee/printers/${encodeURIComponent(readString(row.id))}/test-page`, { method: 'POST' }, `Página de prueba enviada a ${readString(row.name, 'la impresora')}.`)}
              >
                Probar
              </button>
              <button
                type="button"
                className="rounded p-1.5 text-surface-muted hover:bg-brand-50 hover:text-brand-600"
                onClick={() => setPrinterForm({
                  id: readString(row.id),
                  name: readString(row.name),
                  type: readString(row.type, 'LOCAL'),
                  ip: readString(row.ip),
                  port: String(readNumber(row.port, 9100)),
                  protocol: readString(row.protocol, 'RAW'),
                  capabilities: capabilitiesText(row.capabilities),
                })}
                title="Editar impresora"
                aria-label={`Editar impresora ${readString(row.name)}`}
              >
                <Save className="h-4 w-4" />
              </button>
              <button
                type="button"
                className="rounded p-1.5 text-surface-muted hover:bg-warning-500/10 hover:text-warning-600 disabled:opacity-50"
                disabled={busy}
                onClick={() => void mutate(`/api/employee/printers/${encodeURIComponent(readString(row.id))}`, { method: 'PATCH', body: JSON.stringify({ status: readString(row.status).toUpperCase() === 'PAUSED' ? 'ONLINE' : 'PAUSED' }) }, 'Estado de la impresora actualizado.')}
                title={readString(row.status).toUpperCase() === 'PAUSED' ? 'Reanudar impresora' : 'Pausar impresora'}
                aria-label={readString(row.status).toUpperCase() === 'PAUSED' ? 'Reanudar impresora' : 'Pausar impresora'}
              >
                {readString(row.status).toUpperCase() === 'PAUSED' ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
              </button>
            </div>
          )}
        />
      ) : null}

      {view === 'orders' ? (
        <div className="space-y-3">
          <div className="card grid gap-3 p-4 sm:grid-cols-3">
            <div>
              <label htmlFor="employee-status" className="label">Estado</label>
              <select
                id="employee-status"
                className="input"
                value={filters.status}
                onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}
              >
                <option value="">Todos</option>
                {['PENDING', 'PAID', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED'].map((status) => (
                  <option key={status} value={status}>{status}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="employee-station" className="label">ID de estación</label>
              <input
                id="employee-station"
                className="input"
                value={filters.station}
                onChange={(event) => setFilters((current) => ({ ...current, station: event.target.value }))}
                placeholder="pc-01"
              />
            </div>
            <div>
              <label htmlFor="employee-printer" className="label">ID de impresora</label>
              <input
                id="employee-printer"
                className="input"
                value={filters.printer}
                onChange={(event) => setFilters((current) => ({ ...current, printer: event.target.value }))}
                placeholder="printer_789"
              />
            </div>
          </div>
          <DataTable
            rows={orders.rows}
            columns={orderColumns}
            keyExtractor={(row) => row.id}
            loading={orders.loading}
            error={orders.error}
            onRetry={() => void orders.reload()}
            searchable
            searchPlaceholder="Buscar orden…"
            emptyMessage="No hay órdenes con estos filtros."
            actions={(row) => (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  className="rounded p-1.5 text-surface-muted hover:bg-brand-50 hover:text-brand-600"
                  onClick={() => setOrderForm({ id: row.id, status: readString(row.status), station_id: readString(row.station_id), printer_id: readString(row.printer_id) })}
                  title="Reasignar orden"
                  aria-label={`Reasignar orden ${row.id}`}
                >
                  <RotateCcw className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  className="rounded p-1.5 text-success-600 hover:bg-success-500/10 disabled:opacity-50"
                  disabled={busy}
                  onClick={() => void mutate(`/api/employee/orders/${encodeURIComponent(row.id)}/release`, { method: 'POST' }, 'Impresión liberada en mostrador.')}
                  title="Liberar en mostrador"
                  aria-label={`Liberar orden ${row.id}`}
                >
                  <CheckCircle2 className="h-4 w-4" />
                </button>
                <Link href={`/track/${encodeURIComponent(row.id)}`} className="rounded p-1.5 text-surface-muted hover:bg-accent-50 hover:text-accent-600" title="Rastrear orden" aria-label={`Rastrear orden ${row.id}`}>
                  <ClipboardList className="h-4 w-4" />
                </Link>
              </div>
            )}
          />
        </div>
      ) : null}

      <Modal
        open={stationForm !== null}
        onOpenChange={(open) => !open && setStationForm(null)}
        title={stationForm?.id ? 'Editar estación' : 'Registrar estación'}
        description="Los datos deben coincidir con la consola PrintBridge Desktop."
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setStationForm(null)}>Cancelar</button>
            <button type="submit" form="station-form" className="btn-primary" disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Guardar
            </button>
          </>
        }
      >
        {stationForm ? (
          <form id="station-form" onSubmit={(event) => void submitStation(event)} className="space-y-3">
            <div>
              <label htmlFor="station-name" className="label">Nombre de la estación</label>
              <input id="station-name" className="input" value={stationForm.name} onChange={(event) => setStationForm({ ...stationForm, name: event.target.value })} required placeholder="PC-01" />
            </div>
            <div>
              <label htmlFor="station-computer" className="label">Nombre de la computadora</label>
              <input id="station-computer" className="input" value={stationForm.computer_name} onChange={(event) => setStationForm({ ...stationForm, computer_name: event.target.value })} required placeholder="IMPRENTA-PC-01" />
            </div>
            <div>
              <label htmlFor="station-os" className="label">Sistema operativo</label>
              <select id="station-os" className="input" value={stationForm.os} onChange={(event) => setStationForm({ ...stationForm, os: event.target.value })}>
                <option value="WINDOWS">Windows</option>
                <option value="LINUX">Linux</option>
                <option value="MACOS">macOS</option>
              </select>
            </div>
          </form>
        ) : null}
      </Modal>

      <Modal
        open={printerForm !== null}
        onOpenChange={(open) => !open && setPrinterForm(null)}
        title={printerForm?.id ? 'Editar impresora' : 'Registrar impresora'}
        description="Capacidades en formato JSON (color, dúplex, bandejas y tamaños)."
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setPrinterForm(null)}>Cancelar</button>
            <button type="submit" form="printer-form" className="btn-primary" disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Guardar
            </button>
          </>
        }
      >
        {printerForm ? (
          <form id="printer-form" onSubmit={(event) => void submitPrinter(event)} className="space-y-3">
            <div>
              <label htmlFor="printer-name" className="label">Nombre</label>
              <input id="printer-name" className="input" value={printerForm.name} onChange={(event) => setPrinterForm({ ...printerForm, name: event.target.value })} required placeholder="HP LaserJet Pro" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="printer-type" className="label">Tipo</label>
                <select id="printer-type" className="input" value={printerForm.type} onChange={(event) => setPrinterForm({ ...printerForm, type: event.target.value })}>
                  <option value="LOCAL">Local</option>
                  <option value="NETWORK">De red</option>
                  <option value="SHARED">Compartida</option>
                </select>
              </div>
              <div>
                <label htmlFor="printer-protocol" className="label">Protocolo</label>
                <select id="printer-protocol" className="input" value={printerForm.protocol} onChange={(event) => setPrinterForm({ ...printerForm, protocol: event.target.value })}>
                  {['RAW', 'IPP', 'CUPS', 'SMB'].map((protocol) => <option key={protocol} value={protocol}>{protocol}</option>)}
                </select>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="printer-ip" className="label">IP (opcional)</label>
                <input id="printer-ip" className="input" value={printerForm.ip} onChange={(event) => setPrinterForm({ ...printerForm, ip: event.target.value })} placeholder="192.168.1.50" />
              </div>
              <div>
                <label htmlFor="printer-port" className="label">Puerto</label>
                <input id="printer-port" type="number" className="input" value={printerForm.port} onChange={(event) => setPrinterForm({ ...printerForm, port: event.target.value })} />
              </div>
            </div>
            <div>
              <label htmlFor="printer-capabilities" className="label">Capacidades (JSON)</label>
              <textarea id="printer-capabilities" className="textarea" rows={4} value={printerForm.capabilities} onChange={(event) => setPrinterForm({ ...printerForm, capabilities: event.target.value })} />
            </div>
          </form>
        ) : null}
      </Modal>

      <Modal
        open={orderForm !== null}
        onOpenChange={(open) => !open && setOrderForm(null)}
        title="Reasignar orden"
        description="Cambia la estación, impresora o estado de la orden seleccionada."
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setOrderForm(null)}>Cancelar</button>
            <button type="submit" form="order-form" className="btn-primary" disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Aplicar
            </button>
          </>
        }
      >
        {orderForm ? (
          <form id="order-form" onSubmit={(event) => void submitOrder(event)} className="space-y-3">
            <p className="rounded-lg bg-surface-light p-2.5 font-mono text-xs text-surface-muted">Orden: {orderForm.id}</p>
            <div>
              <label htmlFor="order-status" className="label">Estado</label>
              <select id="order-status" className="input" value={orderForm.status} onChange={(event) => setOrderForm({ ...orderForm, status: event.target.value })}>
                <option value="">Sin cambios</option>
                {['PENDING', 'PAID', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED'].map((status) => (
                  <option key={status} value={status}>{status}</option>
                ))}
              </select>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="order-station" className="label">ID de estación</label>
                <input id="order-station" className="input" value={orderForm.station_id} onChange={(event) => setOrderForm({ ...orderForm, station_id: event.target.value })} placeholder="pc-01" />
              </div>
              <div>
                <label htmlFor="order-printer" className="label">ID de impresora</label>
                <input id="order-printer" className="input" value={orderForm.printer_id} onChange={(event) => setOrderForm({ ...orderForm, printer_id: event.target.value })} placeholder="printer_789" />
              </div>
            </div>
          </form>
        ) : null}
      </Modal>

      <Modal
        open={confirm !== null}
        onOpenChange={(open) => !open && setConfirm(null)}
        title="Confirmar eliminación"
        description="Esta acción no se puede deshacer."
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setConfirm(null)}>Cancelar</button>
            <button type="button" className="btn-danger" onClick={() => void confirmDelete()} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} Eliminar
            </button>
          </>
        }
      >
        <p className="text-sm text-surface-muted">
          ¿Eliminar la estación <span className={cn('font-semibold text-surface-ink')}>{confirm?.label}</span>?
          Los trabajos asignados deberán reasignarse a otra estación.
        </p>
      </Modal>
    </PanelShell>
  );
}
