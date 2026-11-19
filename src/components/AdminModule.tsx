'use client';

import {
  AlertCircle,
  CheckCircle2,
  Copy,
  Eye,
  Loader2,
  Pencil,
  Plus,
  Save,
  Trash2,
} from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
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
import { StatusBadge } from '@/components/StatusBadge';
import { StatCard } from '@/components/StatCard';
import { useToast } from '@/components/ToastProvider';
import { useApiList } from '@/components/useApiList';
import {
  apiFetch,
  asRecord,
  errorMessage,
  pickNumber,
  readNumber,
  readString,
  unwrapList,
} from '@/lib/client-api';
import { cn, formatCurrency, formatDate, formatDateTime, maskToken, shortId } from '@/lib/utils';

export type AdminKey =
  | 'dashboard'
  | 'users'
  | 'stations'
  | 'printers'
  | 'orders'
  | 'discounts'
  | 'tariffs'
  | 'payments'
  | 'reports'
  | 'settings';

type Row = Record<string, unknown>;
type FieldType = 'text' | 'email' | 'password' | 'number' | 'select' | 'checkbox' | 'textarea';

interface Field {
  key: string;
  label: string;
  type: FieldType;
  options?: Array<{ value: string; label: string }>;
  required?: boolean;
  placeholder?: string;
}

interface ResourceConfig {
  endpoint: string;
  listKeys: string[];
  singular: string;
  title: string;
  description: string;
  columns: Column<Row>[];
  fields: Field[];
  canCreate?: boolean;
  canEdit?: boolean;
  canDelete?: boolean;
  updateMethod?: 'PATCH' | 'POST';
  canViewDetail?: boolean;
  canTestPage?: boolean;
  canRelease?: boolean;
  trackLink?: boolean;
}

function numberOrString(value: unknown, fallback = '—'): string {
  if (typeof value === 'number' || typeof value === 'string') return String(value);
  return fallback;
}

function stationOnline(row: Row): boolean {
  if (!row.last_seen) return false;
  const time = new Date(String(row.last_seen)).getTime();
  return Number.isFinite(time) && Date.now() - time < 90_000;
}

function buildForm(row: Row | null, fields: Field[]): Record<string, unknown> {
  const source = row ?? {};
  const form: Record<string, unknown> = {};
  fields.forEach((field) => {
    const value = source[field.key];
    if (field.type === 'checkbox') form[field.key] = Boolean(value ?? true);
    else if (field.type === 'number') form[field.key] = value === undefined || value === null ? '' : String(value);
    else form[field.key] = readString(value);
  });
  return form;
}

function payloadFrom(form: Record<string, unknown>, fields: Field[]): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  fields.forEach((field) => {
    const value = form[field.key];
    if (field.type === 'checkbox') payload[field.key] = Boolean(value);
    else if (field.type === 'number') payload[field.key] = value === '' || value === undefined ? null : Number(value);
    else payload[field.key] = readString(value);
  });
  return payload;
}

function FormFields({
  fields,
  form,
  onChange,
}: {
  fields: Field[];
  form: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {fields.map((field) => (
        <div key={field.key} className={field.type === 'textarea' ? 'sm:col-span-2' : ''}>
          <label htmlFor={`admin-${field.key}`} className="label">
            {field.label}
          </label>
          {field.type === 'select' ? (
            <select
              id={`admin-${field.key}`}
              className="input"
              value={readString(form[field.key])}
              onChange={(event) => onChange(field.key, event.target.value)}
              required={field.required}
            >
              {(field.options ?? []).map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          ) : field.type === 'checkbox' ? (
            <button
              type="button"
              id={`admin-${field.key}`}
              onClick={() => onChange(field.key, !form[field.key])}
              className={cn(
                'flex w-full items-center justify-between rounded-lg border px-3 py-2 text-sm font-semibold transition',
                form[field.key] ? 'border-brand-500 bg-brand-50 text-brand-600' : 'border-surface-border bg-white text-surface-muted',
              )}
              aria-pressed={Boolean(form[field.key])}
            >
              {form[field.key] ? 'Activo' : 'Inactivo'}
              <span className={cn('relative h-5 w-9 rounded-full transition', form[field.key] ? 'bg-brand-500' : 'bg-surface-border')}>
                <span className={cn('absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all', form[field.key] ? 'left-[18px]' : 'left-0.5')} />
              </span>
            </button>
          ) : field.type === 'textarea' ? (
            <textarea
              id={`admin-${field.key}`}
              className="textarea"
              rows={4}
              value={readString(form[field.key])}
              onChange={(event) => onChange(field.key, event.target.value)}
              placeholder={field.placeholder}
              required={field.required}
            />
          ) : (
            <input
              id={`admin-${field.key}`}
              type={field.type === 'number' ? 'number' : field.type}
              className="input"
              value={readString(form[field.key])}
              onChange={(event) => onChange(field.key, event.target.value)}
              placeholder={field.placeholder}
              required={field.required}
            />
          )}
        </div>
      ))}
    </div>
  );
}

/* ---------------------------- CRUD genérico ---------------------------- */

function ResourceModule({ config }: { config: ResourceConfig }) {
  const { toast } = useToast();
  const list = useApiList<Row>(config.endpoint, config.listKeys);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [form, setForm] = useState<Record<string, unknown>>({});
  const [confirm, setConfirm] = useState<Row | null>(null);
  const [detail, setDetail] = useState<Row | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  function openCreate() {
    setEditing(null);
    setForm(buildForm(null, config.fields));
    setFormOpen(true);
  }

  function openEdit(row: Row) {
    setEditing(row);
    setForm(buildForm(row, config.fields));
    setFormOpen(true);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    const id = editing ? readString(editing.id) : '';
    const method = editing ? (config.updateMethod ?? 'PATCH') : 'POST';
    const path = editing ? `${config.endpoint}/${encodeURIComponent(id)}` : config.endpoint;
    try {
      await apiFetch(path, { method, body: JSON.stringify(payloadFrom(form, config.fields)) });
      toast({
        title: editing ? 'Registro actualizado' : 'Registro creado',
        description: `${config.singular} guardado correctamente.`,
        variant: 'success',
      });
      setFormOpen(false);
      await list.reload(true);
    } catch (cause) {
      toast({ title: 'No se pudo guardar', description: errorMessage(cause), variant: 'error' });
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm) return;
    setBusy(true);
    try {
      await apiFetch(`${config.endpoint}/${encodeURIComponent(readString(confirm.id))}`, { method: 'DELETE' });
      toast({ title: 'Registro eliminado', variant: 'success' });
      setConfirm(null);
      await list.reload(true);
    } catch (cause) {
      toast({ title: 'No se pudo eliminar', description: errorMessage(cause), variant: 'error' });
    } finally {
      setBusy(false);
    }
  }

  async function openDetail(row: Row) {
    setDetail(row);
    setDetailLoading(true);
    try {
      const data = await apiFetch<unknown>(`${config.endpoint}/${encodeURIComponent(readString(row.id))}`);
      setDetail(asRecord(data));
    } catch (cause) {
      toast({ title: 'No se pudo cargar el detalle', description: errorMessage(cause), variant: 'error' });
    } finally {
      setDetailLoading(false);
    }
  }

  async function simpleAction(row: Row, suffix: string, message: string) {
    setBusy(true);
    try {
      await apiFetch(`${config.endpoint}/${encodeURIComponent(readString(row.id))}${suffix}`, { method: 'POST' });
      toast({ title: 'Acción completada', description: message, variant: 'success' });
      await list.reload(true);
    } catch (cause) {
      toast({ title: 'No se pudo completar', description: errorMessage(cause), variant: 'error' });
    } finally {
      setBusy(false);
    }
  }

  async function copyValue(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast({ title: 'Copiado al portapapeles', variant: 'success' });
    } catch {
      toast({ title: 'No se pudo copiar', variant: 'warning' });
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-surface-ink">{config.title}</h2>
          <p className="text-sm text-surface-muted">{config.description}</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className="btn-secondary text-xs" onClick={() => void list.reload()}>
            <Loader2 className={cn('h-3.5 w-3.5', list.loading && 'animate-spin')} aria-hidden="true" /> Actualizar
          </button>
          {config.canCreate ? (
            <button type="button" className="btn-primary text-xs" onClick={openCreate}>
              <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Nuevo {config.singular}
            </button>
          ) : null}
        </div>
      </div>

      <DataTable
        rows={list.rows}
        columns={config.columns}
        keyExtractor={(row, index) => readString(row.id, String(index))}
        loading={list.loading}
        error={list.error}
        onRetry={() => void list.reload()}
        searchable
        searchPlaceholder={`Buscar ${config.singular}…`}
        emptyMessage={`No hay ${config.singular}s registrados.`}
        actions={(row) => (
          <div className="flex items-center gap-1">
            {config.trackLink ? (
              <Link
                href={`/track/${encodeURIComponent(readString(row.id))}`}
                className="rounded p-1.5 text-surface-muted hover:bg-accent-50 hover:text-accent-600"
                title="Rastrear orden"
                aria-label="Rastrear orden"
              >
                <Eye className="h-4 w-4" />
              </Link>
            ) : null}
            {config.canViewDetail ? (
              <button type="button" className="rounded p-1.5 text-surface-muted hover:bg-brand-50 hover:text-brand-600" onClick={() => void openDetail(row)} title="Ver detalle" aria-label="Ver detalle">
                <Eye className="h-4 w-4" />
              </button>
            ) : null}
            {config.canTestPage ? (
              <button
                type="button"
                className="btn-secondary px-2 py-1 text-[11px]"
                disabled={busy}
                onClick={() => void simpleAction(row, '/test-page', `Página de prueba enviada a ${readString(row.name, 'la impresora')}.`)}
              >
                Probar
              </button>
            ) : null}
            {config.canRelease ? (
              <button
                type="button"
                className="rounded p-1.5 text-success-600 hover:bg-success-500/10 disabled:opacity-50"
                disabled={busy}
                onClick={() => void simpleAction(row, '/release', 'Impresión liberada en mostrador.')}
                title="Liberar en mostrador"
                aria-label="Liberar en mostrador"
              >
                <CheckCircle2 className="h-4 w-4" />
              </button>
            ) : null}
            {config.canEdit ? (
              <button type="button" className="rounded p-1.5 text-surface-muted hover:bg-brand-50 hover:text-brand-600" onClick={() => openEdit(row)} title="Editar" aria-label="Editar">
                <Pencil className="h-4 w-4" />
              </button>
            ) : null}
            {config.canDelete ? (
              <button type="button" className="rounded p-1.5 text-surface-muted hover:bg-danger-500/10 hover:text-danger-600" onClick={() => setConfirm(row)} title="Eliminar" aria-label="Eliminar">
                <Trash2 className="h-4 w-4" />
              </button>
            ) : null}
          </div>
        )}
      />

      <Modal
        open={formOpen}
        onOpenChange={(open) => !open && setFormOpen(false)}
        title={editing ? `Editar ${config.singular}` : `Nuevo ${config.singular}`}
        description="Completa los campos y guarda los cambios."
        size="md"
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setFormOpen(false)}>Cancelar</button>
            <button type="submit" form="admin-form" className="btn-primary" disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Guardar
            </button>
          </>
        }
      >
        <form id="admin-form" onSubmit={(event) => void submit(event)} className="space-y-4">
          {editing ? (
            <p className="rounded-lg bg-surface-light px-3 py-2 font-mono text-[11px] text-surface-muted">ID: {readString(editing.id)}</p>
          ) : null}
          <FormFields
            fields={config.fields}
            form={form}
            onChange={(key, value) => setForm((current) => ({ ...current, [key]: value }))}
          />
        </form>
      </Modal>

      <Modal
        open={confirm !== null}
        onOpenChange={(open) => !open && setConfirm(null)}
        title="Confirmar eliminación"
        description="Esta acción no se puede deshacer."
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setConfirm(null)}>Cancelar</button>
            <button type="button" className="btn-danger" onClick={() => void remove()} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} Eliminar
            </button>
          </>
        }
      >
        <p className="text-sm text-surface-muted">
          ¿Eliminar <span className="font-semibold text-surface-ink">{config.singular}</span> con ID{' '}
          <span className="font-mono text-xs">{shortId(readString(confirm?.id), 16)}</span>?
        </p>
      </Modal>

      <Modal
        open={detail !== null}
        onOpenChange={(open) => !open && setDetail(null)}
        title={`Detalle de ${config.singular}`}
        description={detailLoading ? 'Cargando información…' : undefined}
        size="lg"
        footer={
          <button type="button" className="btn-secondary" onClick={() => setDetail(null)}>Cerrar</button>
        }
      >
        {detailLoading ? (
          <div className="space-y-2"><div className="skeleton h-8 w-full rounded" /><div className="skeleton h-8 w-full rounded" /></div>
        ) : detail ? (
          <dl className="grid gap-2 sm:grid-cols-2">
            {Object.entries(detail).map(([key, value]) => (
              <div key={key} className="rounded-lg border border-surface-border bg-surface-light p-2.5">
                <dt className="text-[10px] font-bold uppercase tracking-wide text-surface-muted">{key}</dt>
                <dd className="mt-0.5 break-words text-xs text-surface-ink">
                  {value !== null && typeof value === 'object' ? JSON.stringify(value) : numberOrString(value)}
                </dd>
              </div>
            ))}
          </dl>
        ) : null}
      </Modal>
    </div>
  );
}

/* ------------------------------- Reportes ------------------------------ */

function ReportsModule() {
  const [summary, setSummary] = useState<Row | null>(null);
  const [printerRows, setPrinterRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [summaryData, printerData] = await Promise.all([
        apiFetch<unknown>('/api/admin/reports/summary'),
        apiFetch<unknown>('/api/admin/reports/printers'),
      ]);
      setSummary(asRecord(summaryData));
      setPrinterRows(unwrapList<Row>(printerData, ['printers', 'usage', 'data']));
    } catch (cause) {
      setError(errorMessage(cause, 'No se pudieron cargar los reportes.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const statusSource =
    asRecord(summary?.statuses ?? summary?.by_status ?? summary?.orders_by_status);
  const statusChart = Array.isArray(statusSource)
    ? (statusSource as Row[]).map((row) => ({
        name: readString(row.name ?? row.status, 'Otros'),
        value: readNumber(row.value ?? row.count ?? row.total, 0),
      }))
    : Object.entries(statusSource).map(([name, value]) => ({
        name,
        value: readNumber(value, 0),
      }));

  const printerChart = printerRows.map((row, index) => ({
    name: readString(row.name ?? row.printer_name, `Impresora ${index + 1}`),
    value: readNumber(row.jobs ?? row.pages ?? row.count ?? row.value, 0),
  }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-surface-ink">Reportes e indicadores</h2>
          <p className="text-sm text-surface-muted">Resumen de operación y uso por impresora.</p>
        </div>
        <button type="button" className="btn-secondary text-xs" onClick={() => void load()}>
          <Loader2 className={cn('h-3.5 w-3.5', loading && 'animate-spin')} aria-hidden="true" /> Actualizar
        </button>
      </div>

      {error ? (
        <div className="flex items-start gap-2 rounded-lg border border-danger-500/25 bg-danger-500/5 p-3 text-sm text-danger-600">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> {error}
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Órdenes totales" value={loading ? '—' : pickNumber(summary, ['total_orders', 'orders', 'orders_count', 'totalOrders'])} icon={Eye} tone="brand" />
        <StatCard label="Ingresos" value={loading ? '—' : formatCurrency(pickNumber(summary, ['revenue', 'total_revenue', 'income', 'total_amount']))} icon={CheckCircle2} tone="success" />
        <StatCard label="Páginas impresas" value={loading ? '—' : pickNumber(summary, ['pages_printed', 'printed_pages', 'pages', 'total_pages'])} icon={Copy} tone="accent" />
        <StatCard label="Órdenes completadas" value={loading ? '—' : pickNumber(summary, ['completed_orders', 'completed', 'orders_completed'])} icon={CheckCircle2} tone="warning" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card p-5">
          <h3 className="text-sm font-bold text-surface-ink">Órdenes por estado</h3>
          {statusChart.length === 0 ? (
            <p className="py-16 text-center text-sm text-surface-muted">Sin datos disponibles.</p>
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
        <div className="card p-5">
          <h3 className="text-sm font-bold text-surface-ink">Uso por impresora</h3>
          {printerChart.length === 0 ? (
            <p className="py-16 text-center text-sm text-surface-muted">Sin datos disponibles.</p>
          ) : (
            <div className="mt-4 h-60">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={printerChart} margin={{ top: 8, right: 8, bottom: 8, left: -20 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="value" fill="#0891B2" radius={[4, 4, 0, 0]} name="Trabajos" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ----------------------------- Configuración --------------------------- */

function SettingsModule() {
  const { toast } = useToast();
  const [engine, setEngine] = useState('sqlite');
  const [databaseUrl, setDatabaseUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    apiFetch<unknown>('/api/admin/db-config')
      .then((data) => {
        if (!active) return;
        const record = asRecord(data);
        const config = asRecord(record.config ?? record.data ?? record);
        const current = config.engine ?? config.provider ?? config.driver ?? record.engine;
        setEngine(readString(current, 'sqlite').toLowerCase());
        setDatabaseUrl(readString(config.database_url ?? config.url ?? record.database_url));
      })
      .catch((cause: unknown) => {
        if (active) setError(errorMessage(cause, 'No se pudo cargar la configuración.'));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    try {
      await apiFetch('/api/admin/db-config', {
        method: 'PATCH',
        body: JSON.stringify({ engine, database_url: databaseUrl || undefined }),
      });
      toast({ title: 'Configuración guardada', description: 'El cambio de motor requiere reiniciar el servidor.', variant: 'success' });
    } catch (cause) {
      toast({ title: 'No se pudo guardar', description: errorMessage(cause), variant: 'error' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-4">
      <div>
        <h2 className="text-lg font-bold text-surface-ink">Configuración de base de datos</h2>
        <p className="text-sm text-surface-muted">Selecciona el motor activo y la cadena de conexión.</p>
      </div>
      {error ? (
        <div className="flex items-start gap-2 rounded-lg border border-danger-500/25 bg-danger-500/5 p-3 text-sm text-danger-600">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> {error}
        </div>
      ) : null}
      <form onSubmit={(event) => void save(event)} className="card space-y-4 p-5">
        {loading ? (
          <div className="skeleton h-20 w-full rounded-lg" />
        ) : (
          <>
            <div>
              <label htmlFor="db-engine" className="label">Motor</label>
              <select id="db-engine" className="input" value={engine} onChange={(event) => setEngine(event.target.value)}>
                <option value="sqlite">SQLite</option>
                <option value="postgresql">PostgreSQL</option>
                <option value="mysql">MySQL / MariaDB</option>
                <option value="sqlserver">SQL Server</option>
              </select>
            </div>
            <div>
              <label htmlFor="db-url" className="label">Cadena de conexión (DATABASE_URL)</label>
              <input id="db-url" className="input" value={databaseUrl} onChange={(event) => setDatabaseUrl(event.target.value)} placeholder="file:./dev.db" />
            </div>
            <p className="rounded-lg border border-warning-500/25 bg-warning-500/5 p-3 text-xs text-warning-600">
              Cambiar el motor requiere reiniciar el servidor y ejecutar las migraciones correspondientes.
            </p>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Guardar configuración
            </button>
          </>
        )}
      </form>
    </div>
  );
}

/* --------------------------- Configuración CRUD ------------------------ */

function useConfigs(): Record<Exclude<AdminKey, 'dashboard' | 'reports' | 'settings'>, ResourceConfig> {
  return {
    users: {
      endpoint: '/api/admin/users',
      listKeys: ['users'],
      singular: 'usuario',
      title: 'Usuarios y roles',
      description: 'Gestiona cuentas, roles y estado de acceso.',
      columns: [
        { key: 'name', header: 'Nombre', value: (row) => readString(row.name), render: (row) => <span className="font-semibold">{readString(row.name, '—')}</span> },
        { key: 'email', header: 'Correo', value: (row) => readString(row.email), render: (row) => <span className="text-xs text-surface-muted">{readString(row.email, '—')}</span> },
        { key: 'role', header: 'Rol', value: (row) => readString(row.role), render: (row) => <StatusBadge status={readString(row.role)} /> },
        { key: 'active', header: 'Estado', value: (row) => String(row.active), render: (row) => <StatusBadge status={row.active === false ? 'INACTIVE' : 'ACTIVE'} /> },
        { key: 'created_at', header: 'Alta', value: (row) => readString(row.created_at), render: (row) => <span className="text-xs text-surface-muted">{formatDate(readString(row.created_at))}</span>, hideOnMobile: true },
      ],
      fields: [
        { key: 'name', label: 'Nombre', type: 'text', required: true },
        { key: 'email', label: 'Correo', type: 'email', required: true },
        { key: 'password', label: 'Contraseña', type: 'password', placeholder: 'Solo al crear' },
        { key: 'role', label: 'Rol', type: 'select', options: [{ value: 'CLIENT', label: 'Cliente' }, { value: 'EMPLOYEE', label: 'Empleado' }, { value: 'ADMIN', label: 'Administrador' }] },
      ],
      canCreate: true,
      canEdit: true,
      canDelete: true,
    },
    stations: {
      endpoint: '/api/employee/stations',
      listKeys: ['stations'],
      singular: 'estación',
      title: 'Estaciones PrintBridge',
      description: 'Computadoras conectadas, telemetría y tokens de acceso.',
      columns: [
        { key: 'name', header: 'Estación', value: (row) => readString(row.name), render: (row) => <span className="font-semibold">{readString(row.name, '—')}</span> },
        { key: 'computer_name', header: 'Equipo', value: (row) => readString(row.computer_name), render: (row) => <span className="text-xs text-surface-muted">{readString(row.computer_name, '—')}</span> },
        { key: 'os', header: 'SO', value: (row) => readString(row.os), render: (row) => <StatusBadge status={readString(row.os)} label={readString(row.os)} /> },
        { key: 'last_seen', header: 'Conexión', value: (row) => readString(row.last_seen), render: (row) => <LivePrinterBadge status={stationOnline(row) ? 'ONLINE' : 'OFFLINE'} lastSeen={readString(row.last_seen)} /> },
        { key: 'token', header: 'Token', value: (row) => readString(row.token), render: (row) => <span className="font-mono text-[11px] text-surface-muted">{maskToken(readString(row.token))}</span>, hideOnMobile: true },
      ],
      fields: [
        { key: 'name', label: 'Nombre', type: 'text', required: true },
        { key: 'computer_name', label: 'Nombre del equipo', type: 'text', required: true },
        { key: 'os', label: 'Sistema operativo', type: 'select', options: [{ value: 'WINDOWS', label: 'Windows' }, { value: 'LINUX', label: 'Linux' }, { value: 'MACOS', label: 'macOS' }] },
      ],
      canCreate: true,
      canEdit: true,
      canDelete: true,
    },
    printers: {
      endpoint: '/api/employee/printers',
      listKeys: ['printers'],
      singular: 'impresora',
      title: 'Impresoras',
      description: 'Impresoras locales, de red y compartidas con sus capacidades.',
      columns: [
        { key: 'name', header: 'Impresora', value: (row) => readString(row.name), render: (row) => <span className="font-semibold">{readString(row.name, '—')}</span> },
        { key: 'type', header: 'Tipo', value: (row) => readString(row.type), render: (row) => <StatusBadge status={readString(row.type)} /> },
        { key: 'ip', header: 'Dirección', value: (row) => readString(row.ip), render: (row) => <span className="text-xs text-surface-muted">{readString(row.ip, 'Local')}</span>, hideOnMobile: true },
        { key: 'protocol', header: 'Protocolo', value: (row) => readString(row.protocol), render: (row) => <span className="text-xs text-surface-muted">{readString(row.protocol, '—')}</span>, hideOnMobile: true },
        { key: 'status', header: 'Estado', value: (row) => readString(row.status), render: (row) => <LivePrinterBadge status={readString(row.status)} /> },
      ],
      fields: [
        { key: 'name', label: 'Nombre', type: 'text', required: true },
        { key: 'type', label: 'Tipo', type: 'select', options: [{ value: 'LOCAL', label: 'Local' }, { value: 'NETWORK', label: 'Red' }, { value: 'SHARED', label: 'Compartida' }] },
        { key: 'ip', label: 'IP', type: 'text' },
        { key: 'port', label: 'Puerto', type: 'number' },
        { key: 'protocol', label: 'Protocolo', type: 'select', options: [{ value: 'RAW', label: 'RAW' }, { value: 'IPP', label: 'IPP' }, { value: 'CUPS', label: 'CUPS' }, { value: 'SMB', label: 'SMB' }] },
        { key: 'capabilities', label: 'Capacidades (JSON)', type: 'textarea' },
      ],
      canCreate: true,
      canEdit: true,
      canTestPage: true,
    },
    orders: {
      endpoint: '/api/employee/orders',
      listKeys: ['orders'],
      singular: 'orden',
      title: 'Órdenes y cola global',
      description: 'Supervisa, reasigna y libera trabajos de impresión.',
      columns: [
        { key: 'id', header: 'Orden', value: (row) => readString(row.id), render: (row) => <span className="font-mono text-xs font-semibold text-brand-600">{shortId(readString(row.id), 12)}</span> },
        { key: 'file_name', header: 'Archivo', value: (row) => readString(row.file_name), render: (row) => <span className="block max-w-44 truncate text-xs">{readString(row.file_name, '—')}</span> },
        { key: 'pages', header: 'Trabajo', value: (row) => readNumber(row.pages, 0), render: (row) => <span className="text-xs text-surface-muted">{readNumber(row.pages, 0)} pág. · {readNumber(row.copies, 1)} copias</span>, hideOnMobile: true },
        { key: 'total_price', header: 'Total', value: (row) => readNumber(row.total_price, 0), render: (row) => <span className="tabular-nums text-xs">{formatCurrency(readNumber(row.total_price, 0))}</span> },
        { key: 'status', header: 'Estado', value: (row) => readString(row.status), render: (row) => <StatusBadge status={readString(row.status)} /> },
        { key: 'created_at', header: 'Fecha', value: (row) => readString(row.created_at), render: (row) => <span className="text-xs text-surface-muted">{formatDate(readString(row.created_at))}</span>, hideOnMobile: true },
      ],
      fields: [
        { key: 'status', label: 'Estado', type: 'select', options: ['PENDING', 'PAID', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED'].map((value) => ({ value, label: value })) },
        { key: 'station_id', label: 'ID de estación', type: 'text' },
        { key: 'printer_id', label: 'ID de impresora', type: 'text' },
      ],
      canEdit: true,
      canRelease: true,
      trackLink: true,
    },
    discounts: {
      endpoint: '/api/admin/discount-rules',
      listKeys: ['rules', 'discount_rules', 'discountRules'],
      singular: 'regla',
      title: 'Reglas de descuento y páginas gratis',
      description: 'Configura umbrales, porcentajes y beneficios por volumen.',
      columns: [
        { key: 'name', header: 'Regla', value: (row) => readString(row.name), render: (row) => <span className="font-semibold">{readString(row.name, '—')}</span> },
        { key: 'type', header: 'Tipo', value: (row) => readString(row.type), render: (row) => <StatusBadge status={readString(row.type)} /> },
        { key: 'threshold', header: 'Umbral', value: (row) => readNumber(row.threshold, 0), render: (row) => <span className="tabular-nums text-xs">{readNumber(row.threshold, 0)} páginas</span> },
        { key: 'value', header: 'Valor', value: (row) => readNumber(row.value, 0), render: (row) => <span className="tabular-nums text-xs">{readNumber(row.value, 0)}</span> },
        { key: 'active', header: 'Estado', value: (row) => String(row.active), render: (row) => <StatusBadge status={row.active === false ? 'INACTIVE' : 'ACTIVE'} /> },
      ],
      fields: [
        { key: 'name', label: 'Nombre', type: 'text', required: true },
        { key: 'type', label: 'Tipo', type: 'select', options: [{ value: 'PERCENTAGE', label: 'Porcentaje' }, { value: 'FIXED', label: 'Monto fijo' }, { value: 'FREE_PAGES', label: 'Páginas gratis' }] },
        { key: 'threshold', label: 'Umbral de páginas', type: 'number' },
        { key: 'value', label: 'Valor', type: 'number' },
        { key: 'active', label: 'Activa', type: 'checkbox' },
      ],
      canCreate: true,
      canEdit: true,
      canDelete: true,
    },
    tariffs: {
      endpoint: '/api/admin/tariffs',
      listKeys: ['tariffs', 'prices'],
      singular: 'tarifa',
      title: 'Tarifario',
      description: 'Precios por página según color, tamaño y dúplex.',
      columns: [
        { key: 'paper_size', header: 'Papel', value: (row) => readString(row.paper_size), render: (row) => <span className="font-semibold">{readString(row.paper_size, '—')}</span> },
        { key: 'color', header: 'Color', value: (row) => String(row.color), render: (row) => <StatusBadge status={row.color ? 'ACTIVE' : 'INACTIVE'} label={row.color ? 'Color' : 'B&N'} /> },
        { key: 'duplex', header: 'Dúplex', value: (row) => String(row.duplex), render: (row) => <StatusBadge status={row.duplex ? 'ACTIVE' : 'INACTIVE'} label={row.duplex ? 'Sí' : 'No'} /> },
        { key: 'price_per_page', header: 'Precio / página', value: (row) => readNumber(row.price_per_page ?? row.price, 0), render: (row) => <span className="tabular-nums">{formatCurrency(readNumber(row.price_per_page ?? row.price, 0))}</span> },
        { key: 'id', header: 'ID', value: (row) => readString(row.id), render: (row) => <span className="font-mono text-[11px] text-surface-muted">{shortId(readString(row.id), 10)}</span>, hideOnMobile: true },
      ],
      fields: [
        { key: 'paper_size', label: 'Tamaño', type: 'select', options: [{ value: 'A4', label: 'A4' }, { value: 'Letter', label: 'Letter' }] },
        { key: 'color', label: 'A color', type: 'checkbox' },
        { key: 'duplex', label: 'Dúplex', type: 'checkbox' },
        { key: 'price_per_page', label: 'Precio por página', type: 'number' },
      ],
      canCreate: true,
    },
    payments: {
      endpoint: '/api/admin/payments',
      listKeys: ['payments'],
      singular: 'pago',
      title: 'Pagos Stripe / PayPal',
      description: 'Consulta transacciones, proveedores y estados de confirmación.',
      columns: [
        { key: 'id', header: 'ID', value: (row) => readString(row.id), render: (row) => <span className="font-mono text-xs font-semibold text-brand-600">{shortId(readString(row.id), 12)}</span> },
        { key: 'order_id', header: 'Orden', value: (row) => readString(row.order_id), render: (row) => <span className="font-mono text-xs text-surface-muted">{shortId(readString(row.order_id), 12)}</span> },
        { key: 'provider', header: 'Proveedor', value: (row) => readString(row.provider), render: (row) => <StatusBadge status={readString(row.provider)} /> },
        { key: 'amount', header: 'Monto', value: (row) => readNumber(row.amount, 0), render: (row) => <span className="tabular-nums">{formatCurrency(readNumber(row.amount, 0))}</span> },
        { key: 'status', header: 'Estado', value: (row) => readString(row.status), render: (row) => <StatusBadge status={readString(row.status)} /> },
        { key: 'created_at', header: 'Fecha', value: (row) => readString(row.created_at), render: (row) => <span className="text-xs text-surface-muted">{formatDateTime(readString(row.created_at))}</span>, hideOnMobile: true },
      ],
      fields: [],
      canViewDetail: true,
    },
  };
}

export function AdminModule({ module }: { module: AdminKey }) {
  const configs = useConfigs();

  if (module === 'dashboard') {
    return (
      <div className="space-y-5">
        <ReportsModule />
        <div>
          <h2 className="text-sm font-bold text-surface-ink">Módulos disponibles</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {(Object.keys(configs) as Array<keyof typeof configs>).map((key) => (
              <Link key={key} href={`/admin/${key}`} className="card p-4 transition hover:border-brand-500 hover:bg-brand-50/40">
                <p className="text-sm font-bold capitalize text-surface-ink">{configs[key].title}</p>
                <p className="mt-1 text-xs text-surface-muted">{configs[key].description}</p>
              </Link>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (module === 'reports') return <ReportsModule />;
  if (module === 'settings') return <SettingsModule />;
  return (
    <ResourceModule
      config={configs[module as Exclude<AdminKey, 'dashboard' | 'reports' | 'settings'>]}
    />
  );
}
