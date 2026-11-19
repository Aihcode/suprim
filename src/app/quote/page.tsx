import type { Metadata } from 'next';
import { ArrowLeft, CheckCircle2, Gift, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { PublicLayout } from '@/components/PublicLayout';
import { QuoteCalculator, type QuoteInitial } from '@/components/QuoteCalculator';

export const metadata: Metadata = {
  title: 'Cotizador de impresión',
  description: 'Cotiza impresiones a color o blanco y negro, con copias, dúplex y descuentos automáticos.',
};

type SearchParams = Record<string, string | string[] | undefined>;

function first(params: SearchParams, key: string): string | undefined {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

function parseNumber(value: string | undefined, fallback: number): number {
  const numeric = Number(value);
  return value && Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : fallback;
}

export default function QuotePage({ searchParams }: { searchParams: SearchParams }) {
  const initial: QuoteInitial = {
    pages: parseNumber(first(searchParams, 'pages'), 1),
    copies: parseNumber(first(searchParams, 'copies'), 1),
    color: ['true', '1', 'color'].includes((first(searchParams, 'color') ?? '').toLowerCase()),
    duplex: ['true', '1', 'duplex'].includes((first(searchParams, 'duplex') ?? '').toLowerCase()),
    paper_size: first(searchParams, 'paper') === 'Letter' ? 'Letter' : 'A4',
  };

  return (
    <PublicLayout>
      <div className="border-b border-surface-border bg-white">
        <div className="section py-8 sm:py-10">
          <Link href="/" className="inline-flex items-center gap-1.5 text-xs font-semibold text-surface-muted transition hover:text-brand-600">
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> Volver al inicio
          </Link>
          <h1 className="mt-3 text-3xl font-black tracking-tight text-surface-ink sm:text-4xl">
            Cotiza tu impresión
          </h1>
          <p className="section-subtitle">
            Ajusta las opciones y mira cómo cambia el precio en tiempo real. Puedes continuar como
            invitado o iniciar sesión para acumular páginas gratis.
          </p>
        </div>
      </div>

      <div className="section grid gap-6 py-8 lg:grid-cols-[1fr_280px] lg:py-10">
        <QuoteCalculator mode="full" initial={initial} />

        <aside className="space-y-4">
          <div className="card p-5">
            <h2 className="text-sm font-bold text-surface-ink">Incluido en cada pedido</h2>
            <ul className="mt-3 space-y-2.5 text-xs leading-relaxed text-surface-muted">
              <li className="flex gap-2"><CheckCircle2 className="h-4 w-4 shrink-0 text-success-600" aria-hidden="true" /> Cotización instantánea antes de pagar.</li>
              <li className="flex gap-2"><CheckCircle2 className="h-4 w-4 shrink-0 text-success-600" aria-hidden="true" /> Descuentos escalonados por volumen.</li>
              <li className="flex gap-2"><CheckCircle2 className="h-4 w-4 shrink-0 text-success-600" aria-hidden="true" /> Seguimiento en vivo de tu trabajo.</li>
            </ul>
          </div>
          <div className="card border-accent-500/30 bg-accent-50/50 p-5">
            <Gift className="h-5 w-5 text-accent-600" aria-hidden="true" />
            <p className="mt-2 text-sm font-bold text-surface-ink">Impresiones gratis</p>
            <p className="mt-1 text-xs leading-relaxed text-surface-muted">
              Al superar ciertos umbrales ganas páginas gratis que se aplican automáticamente en tus
              próximas cotizaciones si inicias sesión.
            </p>
          </div>
          <div className="card p-5">
            <ShieldCheck className="h-5 w-5 text-success-600" aria-hidden="true" />
            <p className="mt-2 text-sm font-bold text-surface-ink">Pago protegido</p>
            <p className="mt-1 text-xs leading-relaxed text-surface-muted">
              Stripe y PayPal confirman el pago antes de enviar el archivo a cualquier estación.
            </p>
          </div>
        </aside>
      </div>
    </PublicLayout>
  );
}
