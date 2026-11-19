import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Providers } from '@/components/Providers';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'PrintFlow ERP — Impresión online con entrega inmediata',
    template: '%s | PrintFlow ERP',
  },
  description:
    'Cotiza, paga y rastrea tus impresiones en tiempo real. Descuentos por volumen, páginas gratis, pago seguro con Stripe y PayPal y estaciones PrintBridge conectadas.',
  keywords: ['impresión online', 'cotizador de impresión', 'PrintFlow', 'PrintBridge', 'ERP imprenta'],
  icons: { icon: '/favicon.svg' },
  openGraph: {
    title: 'PrintFlow ERP — Impresión online con entrega inmediata',
    description: 'Cotización instantánea, pago seguro y seguimiento en vivo de tus impresiones.',
    type: 'website',
    locale: 'es_ES',
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body className="min-h-screen bg-surface-light">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
