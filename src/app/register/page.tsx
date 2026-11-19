import type { Metadata } from 'next';
import { BadgeCheck, Gift, Printer } from 'lucide-react';
import Link from 'next/link';
import { AuthForm } from '@/components/AuthForm';
import { PublicLayout } from '@/components/PublicLayout';

export const metadata: Metadata = {
  title: 'Crear cuenta',
  description: 'Regístrate gratis en PrintFlow y acumula páginas gratis en cada pedido.',
};

export default function RegisterPage() {
  return (
    <PublicLayout>
      <div className="section grid gap-8 py-10 lg:grid-cols-[0.9fr_1.1fr] lg:py-16">
        <div className="mx-auto w-full max-w-md">
          <AuthForm mode="register" />
        </div>
        <div className="flex flex-col justify-center">
          <p className="text-[11px] font-bold uppercase tracking-widest text-accent-600">Cuenta gratis</p>
          <h2 className="section-title mt-2">Imprime más, paga menos</h2>
          <p className="section-subtitle">
            Registrarte te permite acumular impresiones gratis, recibir descuentos automáticos y
            revisar todos tus comprobantes cuando quieras.
          </p>
          <ul className="mt-6 space-y-3 text-sm text-surface-muted">
            {[
              { icon: Gift, text: 'Páginas gratis aplicadas automáticamente en tus cotizaciones.' },
              { icon: BadgeCheck, text: 'Historial completo de órdenes y pagos.' },
              { icon: Printer, text: 'Seguimiento en vivo desde la estación de impresión.' },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <li key={item.text} className="flex items-start gap-2.5">
                  <Icon className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" aria-hidden="true" />
                  {item.text}
                </li>
              );
            })}
          </ul>
          <p className="mt-5 text-xs text-surface-muted">
            ¿Ya tienes cuenta?{' '}
            <Link href="/login" className="font-semibold text-brand-600 hover:underline">
              Inicia sesión aquí
            </Link>
          </p>
        </div>
      </div>
    </PublicLayout>
  );
}
