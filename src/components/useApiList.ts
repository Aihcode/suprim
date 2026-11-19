'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch, errorMessage, unwrapList } from '@/lib/client-api';

/** Carga genérica de listas con estados de carga/error y recarga manual. */
export function useApiList<T>(path: string | null, listKeys: string[] = []) {
  const keyString = listKeys.join('|');
  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState<boolean>(Boolean(path));
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (silent = false) => {
      if (!path) {
        setRows([]);
        setLoading(false);
        setError(null);
        return;
      }
      if (!silent) setLoading(true);
      try {
        const data = await apiFetch<unknown>(path);
        setRows(unwrapList<T>(data, keyString ? keyString.split('|') : []));
        setError(null);
      } catch (cause) {
        setError(errorMessage(cause, 'No se pudieron cargar los datos.'));
        if (!silent) setRows([]);
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [path, keyString],
  );

  useEffect(() => {
    void load();
  }, [load]);

  return { rows, setRows, loading, error, reload: load, setError };
}
