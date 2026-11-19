import type { Metadata } from 'next';
import { DemoCheckout } from '@/components/DemoCheckout';
import { PublicLayout } from '@/components/PublicLayout';

export const metadata: Metadata = {
  title: 'Confirmación de pago demo',
  description: 'Confirma el pago de prueba y envía tu trabajo a la cola de impresión.',
};

export default function DemoCheckoutPage({ params }: { params: { id: string } }) {
  return (
    <PublicLayout>
      <DemoCheckout id={params.id} />
    </PublicLayout>
  );
}
