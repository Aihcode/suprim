import {
  ArrowRight,
  BadgeCheck,
  CheckCircle2,
  Clock3,
  CreditCard,
  FileUp,
  Gauge,
  Gift,
  LockKeyhole,
  Printer,
  Sparkles,
  TrendingDown,
  Wallet,
} from 'lucide-react';
import Link from 'next/link';
import { LiveStations } from '@/components/LiveStations';
import { PublicLayout } from '@/components/PublicLayout';
import { QuoteCalculator } from '@/components/QuoteCalculator';

const benefits = [
  {
    icon: TrendingDown,
    title: 'Desde 50 páginas',
    discount: '5% de descuento',
    detail: 'Precios mejores cuanto más imprimes, aplicados de forma automática.',
    tone: 'bg-brand-50 text-brand-600',
  },
  {
    icon: Gift,
    title: 'Desde 100 páginas',
    discount: '10% + 10 páginas gratis',
    detail: 'Acumula páginas gratis para tus próximos trabajos.',
    tone: 'bg-accent-50 text-accent-600',
  },
  {
    icon: Sparkles,
    title: 'Desde 250 páginas',
    discount: '15% + 30 páginas gratis',
    detail: 'Ideal para producciones grandes y pedidos recurrentes.',
    tone: 'bg-success-500/10 text-success-600',
  },
];

const steps = [
  { icon: FileUp, title: 'Sube tu archivo', text: 'PDF, Word o imágenes. Detectamos las páginas automáticamente.' },
  { icon: Gauge, title: 'Cotiza al instante', text: 'Escoge color, copias, dúplex y papel. Ves el precio final antes de pagar.' },
  { icon: CreditCard, title: 'Paga de forma segura', text: 'Stripe o PayPal. Ningún trabajo se imprime sin confirmación de pago.' },
  { icon: Printer, title: 'Sigue tu impresión', text: 'Recibe el progreso en vivo desde la estación hasta que esté lista.' },
];

export default function HomePage() {
  return (
    <PublicLayout>
      {/* Hero con cotizador rápido */}
      <section className="relative overflow-hidden bg-gradient-to-br from-brand-700 via-brand-600 to-accent-600 text-white">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.14]"
          style={{
            backgroundImage:
              'linear-gradient(to right, white 1px, transparent 1px), linear-gradient(to bottom, white 1px, transparent 1px)',
            backgroundSize: '48px 48px',
          }}
          aria-hidden="true"
        />
        <div className="section relative grid items-start gap-8 py-12 lg:grid-cols-[0.85fr_1.15fr] lg:gap-12 lg:py-16">
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide ring-1 ring-inset ring-white/20">
              <span className="h-1.5 w-1.5 rounded-full bg-accent-100 animate-pulse-dot" aria-hidden="true" />
              Impresión profesional en minutos
            </span>
            <h1 className="mt-5 text-4xl font-black leading-[1.1] tracking-tight sm:text-5xl lg:text-6xl">
              Imprime en línea.{' '}
              <span className="text-accent-100">Recibe al instante.</span>
            </h1>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-blue-50/90 sm:text-lg">
              Cotiza tu documento en segundos, paga con Stripe o PayPal y sigue cada página en tiempo
              real desde nuestras estaciones PrintBridge conectadas.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href="/quote" className="inline-flex items-center gap-2 rounded-lg bg-white px-5 py-3 text-sm font-bold text-brand-600 shadow-lg transition hover:bg-blue-50">
                Cotizar ahora <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
              <Link href="/#como-funciona" className="inline-flex items-center gap-2 rounded-lg border border-white/30 px-5 py-3 text-sm font-bold text-white transition hover:bg-white/10">
                Cómo funciona
              </Link>
            </div>
            <ul className="mt-7 grid gap-2.5 text-sm text-blue-50/90 sm:grid-cols-2">
              {[
                'Descuentos por volumen automáticos',
                'Páginas gratis acumulables',
                'Progreso página por página en vivo',
                'Sin filas ni formularios largos',
              ].map((item) => (
                <li key={item} className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-accent-100" aria-hidden="true" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <QuoteCalculator mode="compact" className="border-0 shadow-2xl" />
        </div>
      </section>

      {/* Confianza */}
      <section className="border-b border-surface-border bg-white">
        <div className="section grid gap-4 py-6 sm:grid-cols-3">
          {[
            { icon: LockKeyhole, title: 'Pago 100% seguro', text: 'Stripe y PayPal con webhooks verificados.' },
            { icon: Clock3, title: 'Entrega rápida', text: 'Cola automática en estaciones conectadas.' },
            { icon: BadgeCheck, title: 'Precio transparente', text: 'Descuentos y páginas gratis visibles antes de pagar.' },
          ].map((item) => {
            const Icon = item.icon;
            return (
              <div key={item.title} className="flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-light text-brand-600">
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </span>
                <div>
                  <p className="text-sm font-bold text-surface-ink">{item.title}</p>
                  <p className="text-xs text-surface-muted">{item.text}</p>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Beneficios por volumen */}
      <section id="beneficios" className="section scroll-mt-20 py-14 sm:py-20">
        <div className="text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-500/10 px-3 py-1 text-xs font-bold text-accent-600">
            <Gift className="h-3.5 w-3.5" aria-hidden="true" /> Beneficios por volumen
          </span>
          <h2 className="section-title mt-3">Cuanto más imprimes, más ahorras</h2>
          <p className="section-subtitle mx-auto">
            Nuestras reglas de descuento y páginas gratis se aplican automáticamente en el cotizador
            y en tu checkout.
          </p>
        </div>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {benefits.map((benefit) => {
            const Icon = benefit.icon;
            return (
              <div key={benefit.title} className="card relative overflow-hidden p-5">
                <div className={`flex h-11 w-11 items-center justify-center rounded-lg ${benefit.tone}`}>
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </div>
                <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-surface-muted">{benefit.title}</p>
                <p className="mt-1 text-xl font-extrabold text-surface-ink">{benefit.discount}</p>
                <p className="mt-2 text-sm leading-relaxed text-surface-muted">{benefit.detail}</p>
                <span className="absolute right-4 top-4 rounded-full bg-accent-50 px-2 py-1 text-[10px] font-bold text-accent-600">
                  Automático
                </span>
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-center text-[11px] text-surface-muted">
          Los umbrales y porcentajes exactos se configuran desde el panel de administración.
        </p>
      </section>

      {/* Cómo funciona */}
      <section id="como-funciona" className="scroll-mt-20 border-y border-surface-border bg-white py-14 sm:py-20">
        <div className="section">
          <div className="text-center">
            <h2 className="section-title">Cómo funciona</h2>
            <p className="section-subtitle mx-auto">Cuatro pasos y tu documento está listo para recoger.</p>
          </div>
          <div className="mt-9 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {steps.map((step, index) => {
              const Icon = step.icon;
              return (
                <div key={step.title} className="relative rounded-xl border border-surface-border bg-surface-light p-5">
                  <span className="absolute right-4 top-3 text-3xl font-black text-surface-border">0{index + 1}</span>
                  <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <h3 className="mt-4 text-sm font-bold text-surface-ink">{step.title}</h3>
                  <p className="mt-1.5 text-xs leading-relaxed text-surface-muted">{step.text}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Pagos seguros */}
      <section className="section py-14 sm:py-20">
        <div className="grid items-center gap-8 lg:grid-cols-2">
          <div>
            <span className="text-[11px] font-bold uppercase tracking-widest text-brand-600">Checkout confiable</span>
            <h2 className="section-title mt-2">Paga como prefieras, imprime sin esperar</h2>
            <p className="section-subtitle">
              Aceptamos Stripe y PayPal con validación criptográfica de webhooks. El trabajo solo se
              envía a la estación después de confirmarse el pago.
            </p>
            <ul className="mt-5 space-y-2 text-sm text-surface-muted">
              <li className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-success-600" aria-hidden="true" /> ID de transacción e historial en tu portal.</li>
              <li className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-success-600" aria-hidden="true" /> Opción DEMO para probar el flujo sin cobros.</li>
              <li className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-success-600" aria-hidden="true" /> Sigue imprimiendo: repite, agrega copias o vuelve a cotizar.</li>
            </ul>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="card p-5">
              <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                <CreditCard className="h-5 w-5" aria-hidden="true" />
              </span>
              <p className="mt-4 text-lg font-extrabold text-surface-ink">Stripe</p>
              <p className="mt-1 text-sm text-surface-muted">Tarjetas de crédito y débito, con checkout hospedado y webhooks firmados.</p>
            </div>
            <div className="card p-5">
              <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-accent-50 text-accent-600">
                <Wallet className="h-5 w-5" aria-hidden="true" />
              </span>
              <p className="mt-4 text-lg font-extrabold text-surface-ink">PayPal</p>
              <p className="mt-1 text-sm text-surface-muted">Paga con tu cuenta PayPal o saldo, con confirmación oficial de la orden.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Estaciones en vivo */}
      <section className="border-y border-surface-border bg-white py-14 sm:py-20">
        <div className="section">
          <LiveStations />
        </div>
      </section>

      {/* CTA */}
      <section className="section py-14 sm:py-20">
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-brand-700 via-brand-600 to-accent-600 px-6 py-10 text-center text-white sm:px-12 sm:py-14">
          <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-white/10" aria-hidden="true" />
          <h2 className="text-2xl font-black sm:text-3xl">¿Listo para imprimir?</h2>
          <p className="mx-auto mt-2 max-w-xl text-sm text-blue-50/90 sm:text-base">
            Sube tu archivo, descubre cuánto ahorras y recibe tu impresión con seguimiento en tiempo real.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link href="/quote" className="inline-flex items-center gap-2 rounded-lg bg-white px-5 py-3 text-sm font-bold text-brand-600 transition hover:bg-blue-50">
              Cotizar mi documento <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
            <Link href="/register" className="inline-flex items-center gap-2 rounded-lg border border-white/40 px-5 py-3 text-sm font-bold transition hover:bg-white/10">
              Crear cuenta gratis
            </Link>
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}
