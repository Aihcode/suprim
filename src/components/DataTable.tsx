'use client';

import { AlertCircle, ArrowDown, ArrowUp, Inbox, RefreshCw, Search } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface Column<T> {
  key: string;
  header: string;
  render?: (row: T) => ReactNode;
  value?: (row: T) => string | number | null | undefined;
  className?: string;
  hideOnMobile?: boolean;
}

export interface DataTableProps<T> {
  rows: T[];
  columns: Column<T>[];
  keyExtractor?: (row: T, index: number) => string;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  emptyMessage?: string;
  actions?: (row: T) => ReactNode;
  actionsHeader?: string;
  searchable?: boolean;
  searchPlaceholder?: string;
  pageSize?: number;
  toolbar?: ReactNode;
  className?: string;
}

function cellValue<T>(row: T, column: Column<T>): string {
  if (column.value) {
    const value = column.value(row);
    return value === null || value === undefined ? '' : String(value);
  }
  const record = row as Record<string, unknown>;
  const value = record?.[column.key];
  return value === null || value === undefined ? '' : String(value);
}

export function DataTable<T>({
  rows,
  columns,
  keyExtractor,
  loading = false,
  error = null,
  onRetry,
  emptyMessage = 'No hay registros para mostrar.',
  actions,
  actionsHeader = 'Acciones',
  searchable = false,
  searchPlaceholder = 'Buscar…',
  pageSize = 10,
  toolbar,
  className,
}: DataTableProps<T>) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null);
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    let result = normalized
      ? rows.filter((row) =>
          columns.some((column) => cellValue(row, column).toLowerCase().includes(normalized)),
        )
      : [...rows];

    if (sort) {
      const column = columns.find((item) => item.key === sort.key);
      if (column) {
        result = [...result].sort((a, b) => {
          const left = cellValue(a, column);
          const right = cellValue(b, column);
          const leftNumber = Number(left);
          const rightNumber = Number(right);
          const comparison =
            left !== '' && right !== '' && Number.isFinite(leftNumber) && Number.isFinite(rightNumber)
              ? leftNumber - rightNumber
              : left.localeCompare(right, 'es');
          return sort.direction === 'asc' ? comparison : -comparison;
        });
      }
    }
    return result;
  }, [rows, columns, query, sort]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const visible = filtered.slice(safePage * pageSize, safePage * pageSize + pageSize);

  function toggleSort(key: string) {
    setSort((current) =>
      current?.key === key
        ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
        : { key, direction: 'asc' },
    );
    setPage(0);
  }

  return (
    <div className={cn('card overflow-hidden', className)}>
      {(searchable || toolbar) && !loading && !error ? (
        <div className="flex flex-col gap-3 border-b border-surface-border bg-surface-light px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          {searchable ? (
            <label className="relative w-full sm:max-w-xs">
              <span className="sr-only">{searchPlaceholder}</span>
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-surface-muted" aria-hidden="true" />
              <input
                type="search"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPage(0);
                }}
                placeholder={searchPlaceholder}
                className="input w-full pl-9"
              />
            </label>
          ) : (
            <span />
          )}
          {toolbar ? <div className="flex flex-wrap items-center gap-2">{toolbar}</div> : null}
        </div>
      ) : null}

      {loading ? (
        <div className="space-y-2 p-4" aria-busy="true" aria-label="Cargando datos">
          {[0, 1, 2, 3].map((index) => (
            <div key={index} className="skeleton h-10 w-full rounded-md" />
          ))}
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center gap-3 px-4 py-12 text-center">
          <AlertCircle className="h-8 w-8 text-danger-500" aria-hidden="true" />
          <p className="text-sm font-semibold text-surface-ink">No se pudieron cargar los datos</p>
          <p className="max-w-md text-xs text-surface-muted">{error}</p>
          {onRetry ? (
            <button type="button" onClick={onRetry} className="btn-secondary">
              <RefreshCw className="h-4 w-4" aria-hidden="true" /> Reintentar
            </button>
          ) : null}
        </div>
      ) : visible.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 px-4 py-12 text-center">
          <Inbox className="h-8 w-8 text-surface-muted" aria-hidden="true" />
          <p className="text-sm font-semibold text-surface-ink">{emptyMessage}</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-left text-sm">
            <thead className="bg-surface-light">
              <tr>
                {columns.map((column) => (
                  <th
                    key={column.key}
                    scope="col"
                    className={cn(
                      'whitespace-nowrap border-b border-surface-border px-4 py-3 text-[11px] font-bold uppercase tracking-wide text-surface-muted',
                      column.hideOnMobile && 'hidden md:table-cell',
                      column.className,
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => toggleSort(column.key)}
                      className="inline-flex items-center gap-1 transition hover:text-brand-600"
                    >
                      {column.header}
                      {sort?.key === column.key ? (
                        sort.direction === 'asc' ? (
                          <ArrowUp className="h-3 w-3" aria-hidden="true" />
                        ) : (
                          <ArrowDown className="h-3 w-3" aria-hidden="true" />
                        )
                      ) : null}
                    </button>
                  </th>
                ))}
                {actions ? (
                  <th
                    scope="col"
                    className="whitespace-nowrap border-b border-surface-border px-4 py-3 text-[11px] font-bold uppercase tracking-wide text-surface-muted"
                  >
                    {actionsHeader}
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-border bg-white">
              {visible.map((row, index) => (
                <tr key={keyExtractor ? keyExtractor(row, index) : String(index)} className="transition hover:bg-surface-light/70">
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      className={cn(
                        'px-4 py-3 align-middle text-surface-ink',
                        column.hideOnMobile && 'hidden md:table-cell',
                        column.className,
                      )}
                    >
                      {column.render ? column.render(row) : cellValue(row, column) || '—'}
                    </td>
                  ))}
                  {actions ? <td className="px-4 py-3 align-middle">{actions(row)}</td> : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && !error && filtered.length > pageSize ? (
        <div className="flex items-center justify-between gap-3 border-t border-surface-border bg-surface-light px-4 py-3 text-xs text-surface-muted">
          <span>
            {safePage * pageSize + 1}–{Math.min((safePage + 1) * pageSize, filtered.length)} de{' '}
            {filtered.length}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn-secondary px-2.5 py-1 text-xs"
              disabled={safePage === 0}
              onClick={() => setPage((current) => Math.max(0, current - 1))}
            >
              Anterior
            </button>
            <span className="tabular-nums">
              {safePage + 1} / {pageCount}
            </span>
            <button
              type="button"
              className="btn-secondary px-2.5 py-1 text-xs"
              disabled={safePage >= pageCount - 1}
              onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))}
            >
              Siguiente
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
