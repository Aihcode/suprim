import type { Metadata } from 'next';
import { Clock3, Gift, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { AuthForm } from '@/components/AuthForm';
import { PublicLayout } from '@/components/PublicLayout';

export const metadata: Metadata = {
  title: 'Iniciar sesión',
  description: 'Accede a tu cuenta de PrintFlow para gestionar tus impresiones y páginas gratis.',
};

export default function LoginPage({
  searchParams,
}: {
  searchParams: { callbackUrl?: string | string[] };
}) {
  const callback = searchParams.callbackUrl;
  const callbackUrl = Array.isArray(callback) ? callback[0] : callback;

  return (
    <PublicLayout>
      <div className="section grid gap-8 py-10 lg:grid-cols-[0.9fr_1.1fr] lg:py-16">
        <div className="mx-auto w-full max-w-md">
          <AuthForm mode="login" callbackUrl={callbackUrl} />
        </div>
        <div className="flex flex-col justify-center">
          <p className="text-[11px] font-bold uppercase tracking-widest text-brand-600">Tu cuenta PrintFlow</p>
          <h2 className="section-title mt-2">Todo tu historial de impresión en un solo lugar</h2>
          <p className="section-subtitle">
            Inicia sesión para ver tus órdenes, descargar comprobantes, controlar tu saldo de
            impresiones gratis y seguir cada trabajo en tiempo real.
          </p>
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {[
              { icon: Clock3, title: 'Seguimiento en vivo', text: 'Consulta el avance página por página de cada orden.' },
              { icon: Gift, title: 'Páginas gratis', text: 'Revisa tu saldo y cómo lo has acumulado.' },
              { icon: ShieldCheck, title: 'Pagos seguros', text: 'Stripe y PayPal con ID de transacción.' },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.title} className="card flex gap-3 p-4">
                  <Icon className="h-5 w-5 shrink-0 text-accent-600" aria-hidden="true" />
                  <div>
                    <p className="text-sm font-bold text-surface-ink">{item.title}</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-surface-muted">{item.text}</p>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="mt-5 text-xs text-surface-muted">
            ¿Necesitas ayuda?{' '}
            <Link href="/#como-funciona" className="font-semibold text-brand-600 hover:underline">
              Conoce cómo funciona el servicio
            </Link>
          </p>
        </div>
      </div>
    </PublicLayout>
  );
}
