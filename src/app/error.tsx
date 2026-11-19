'use client';

import { AlertTriangle } from 'lucide-react';
import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-light px-4">
      <div className="card max-w-md p-6 text-center">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-danger-500/10 text-danger-600">
          <AlertTriangle className="h-7 w-7" aria-hidden="true" />
        </span>
        <h1 className="mt-4 text-xl font-bold text-surface-ink">Algo salió mal</h1>
        <p className="mt-2 text-sm text-surface-muted">
          No pudimos cargar esta sección. Intenta nuevamente; si el problema continúa, contacta con
          soporte.
        </p>
        <button type="button" onClick={reset} className="btn-primary mt-5">
          Reintentar
        </button>
      </div>
    </div>
  );
}
