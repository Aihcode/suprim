import { FileQuestion } from 'lucide-react';
import Link from 'next/link';
import { PublicLayout } from '@/components/PublicLayout';

export default function NotFound() {
  return (
    <PublicLayout>
      <div className="section flex min-h-[55vh] flex-col items-center justify-center py-16 text-center">
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-brand-50 text-brand-600">
          <FileQuestion className="h-8 w-8" aria-hidden="true" />
        </span>
        <h1 className="mt-5 text-3xl font-black text-surface-ink">Página no encontrada</h1>
        <p className="mt-2 max-w-md text-sm text-surface-muted">
          Es posible que el enlace haya cambiado o que el módulo no exista. Vuelve al inicio para
          continuar.
        </p>
        <Link href="/" className="btn-primary mt-6">
          Volver al inicio
        </Link>
      </div>
    </PublicLayout>
  );
}
