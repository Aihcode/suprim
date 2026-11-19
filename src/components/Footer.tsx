import { Printer, ShieldCheck } from 'lucide-react';
import Link from 'next/link';

const groups = [
  {
    title: 'Servicio',
    links: [
      { href: '/', label: 'Inicio' },
      { href: '/quote', label: 'Cotizar documento' },
      { href: '/#como-funciona', label: 'Cómo funciona' },
      { href: '/#beneficios', label: 'Beneficios por volumen' },
    ],
  },
  {
    title: 'Tu cuenta',
    links: [
      { href: '/client', label: 'Portal cliente' },
      { href: '/login', label: 'Iniciar sesión' },
      { href: '/register', label: 'Crear cuenta' },
    ],
  },
  {
    title: 'Seguimiento',
    links: [
      { href: '/track/demo', label: 'Rastrear una orden' },
      { href: '/checkout/demo', label: 'Estado del pago' },
    ],
  },
];

export function Footer() {
  return (
    <footer className="border-t border-surface-border bg-white">
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-5">
          <div className="lg:col-span-2">
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-brand-600 to-accent-500 text-white">
                <Printer className="h-5 w-5" aria-hidden="true" />
              </span>
              <span className="text-sm font-extrabold text-surface-ink">PrintFlow ERP</span>
            </div>
            <p className="mt-3 max-w-sm text-sm leading-relaxed text-surface-muted">
              Impresión profesional en línea con cotización instantánea, pago seguro y seguimiento en
              tiempo real desde cualquier dispositivo.
            </p>
            <p className="mt-4 flex items-center gap-1.5 text-xs font-medium text-success-600">
              <ShieldCheck className="h-4 w-4" aria-hidden="true" /> Pagos protegidos con Stripe y PayPal
            </p>
          </div>
          {groups.map((group) => (
            <div key={group.title}>
              <p className="text-[11px] font-bold uppercase tracking-wider text-surface-ink">{group.title}</p>
              <ul className="mt-3 space-y-2">
                {group.links.map((link) => (
                  <li key={link.href + link.label}>
                    <Link href={link.href} className="text-sm text-surface-muted transition hover:text-brand-600">
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-8 flex flex-col gap-2 border-t border-surface-border pt-5 text-xs text-surface-muted sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} PrintFlow ERP. Todos los derechos reservados.</p>
          <p>Hecho para imprentas modernas · PrintBridge Desktop</p>
        </div>
      </div>
    </footer>
  );
}
